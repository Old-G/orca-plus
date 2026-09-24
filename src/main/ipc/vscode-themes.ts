import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import type {
  ImportedThemeSummary,
  InstalledThemeExtensionSummary,
  OpenThemeSourceResult,
  OpenVsxThemeSearchResult,
  ThemeSourceRequest
} from '../../shared/vscode-theme/vscode-theme-ipc'
import type {
  ImportedVscodeTheme,
  VscodeThemeOrigin
} from '../../shared/vscode-theme/vscode-theme-types'
import {
  listImportedThemes,
  readImportedTheme,
  removeImportedTheme,
  saveImportedTheme
} from '../vscode-themes/imported-theme-store'
import { findInstalledThemeExtensions } from '../vscode-themes/installed-vscode-themes'
import { downloadOpenVsxExtension, searchOpenVsxThemes } from '../vscode-themes/open-vsx-client'
import { vsixThemeSource } from '../vscode-themes/theme-file-sources'
import {
  readExtensionManifest,
  resolveExtensionTheme,
  type ExtensionManifest,
  type ThemeFileSource
} from '../vscode-themes/vscode-theme-loader'
import { openVsixArchive } from '../vscode-themes/vsix-zip-reader'

// Custom build (vscode-theme-import): browse installed / Open VSX / .vsix themes and import one.

type OpenSource = {
  source: ThemeFileSource
  manifest: ExtensionManifest
  origin: VscodeThemeOrigin
}

const MAX_OPEN_SOURCES = 5
const MAX_VSIX_FILE_BYTES = 64 * 1024 * 1024
const openSources = new Map<string, OpenSource>()

function themesDir(): string {
  return join(app.getPath('userData'), 'themes')
}

function remember(entry: OpenSource): OpenThemeSourceResult {
  if (entry.manifest.themes.length === 0) {
    return { error: 'no-themes' }
  }
  const token = randomUUID()
  openSources.set(token, entry)
  // Why: a downloaded .vsix stays in memory only until a few newer sources replace it.
  for (const key of [...openSources.keys()].slice(0, -MAX_OPEN_SOURCES)) {
    openSources.delete(key)
  }
  const { displayName, version, themes } = entry.manifest
  return { token, displayName, version, themes: themes.map(({ label, base }) => ({ label, base })) }
}

async function openVsixBytes(bytes: Buffer): Promise<Omit<OpenSource, 'origin'> | null> {
  try {
    const source = vsixThemeSource(openVsixArchive(bytes))
    return { source, manifest: await readExtensionManifest(source) }
  } catch {
    return null
  }
}

async function openSource(
  event: Electron.IpcMainInvokeEvent,
  request: ThemeSourceRequest
): Promise<OpenThemeSourceResult> {
  if (request.kind === 'installed') {
    const found = (await findInstalledThemeExtensions()).find(
      (extension) =>
        extension.editor === request.editor && extension.extensionId === request.extensionId
    )
    if (!found) {
      return { error: 'not-found' }
    }
    const manifest = await readExtensionManifest(found.source)
    const origin: VscodeThemeOrigin = {
      kind: 'installed',
      editor: found.editor,
      extensionId: found.extensionId,
      version: found.version
    }
    return remember({ source: found.source, manifest, origin })
  }
  if (request.kind === 'open-vsx') {
    const downloaded = await downloadOpenVsxExtension(request.namespace, request.name).catch(
      () => null
    )
    if (!downloaded) {
      return { error: 'network' }
    }
    const opened = await openVsixBytes(downloaded.bytes)
    if (!opened) {
      return { error: 'invalid-extension' }
    }
    const extensionId = `${request.namespace}.${request.name}`.toLowerCase()
    return remember({
      ...opened,
      origin: {
        kind: 'open-vsx',
        extensionId,
        version: downloaded.version || opened.manifest.version
      }
    })
  }
  const options: Electron.OpenDialogOptions = {
    title: 'Import VS Code theme',
    properties: ['openFile'],
    filters: [{ name: 'VS Code extension', extensions: ['vsix'] }]
  }
  const window = BrowserWindow.fromWebContents(event.sender)
  const picked = window
    ? await dialog.showOpenDialog(window, options)
    : await dialog.showOpenDialog(options)
  const path = picked.filePaths[0]
  if (picked.canceled || !path) {
    return null
  }
  const bytes = await readFile(path).catch(() => null)
  const opened = bytes && bytes.length <= MAX_VSIX_FILE_BYTES ? await openVsixBytes(bytes) : null
  return opened
    ? remember({ ...opened, origin: { kind: 'vsix-file', fileName: basename(path) } })
    : { error: 'invalid-extension' }
}

export function registerVscodeThemeHandlers(): void {
  ipcMain.handle(
    'vscodeThemes:listInstalled',
    async (): Promise<InstalledThemeExtensionSummary[]> =>
      (await findInstalledThemeExtensions()).map(({ source: _source, ...summary }) => summary)
  )
  ipcMain.handle(
    'vscodeThemes:searchOpenVsx',
    async (_event, query: unknown): Promise<OpenVsxThemeSearchResult[] | null> =>
      typeof query === 'string' ? searchOpenVsxThemes(query.slice(0, 200)).catch(() => null) : []
  )
  ipcMain.handle('vscodeThemes:openSource', (event, request: ThemeSourceRequest) =>
    openSource(event, request)
  )
  ipcMain.handle(
    'vscodeThemes:importTheme',
    async (_event, token: unknown, label: unknown): Promise<ImportedThemeSummary | null> => {
      const opened = typeof token === 'string' ? openSources.get(token) : undefined
      const entry = opened?.manifest.themes.find((theme) => theme.label === label)
      if (!opened || !entry) {
        return null
      }
      const theme = await resolveExtensionTheme(opened.source, entry).catch(() => null)
      return theme ? saveImportedTheme(themesDir(), theme, opened.origin) : null
    }
  )
  ipcMain.handle('vscodeThemes:listImported', () => listImportedThemes(themesDir()))
  ipcMain.handle(
    'vscodeThemes:readImported',
    (_event, id: unknown): Promise<ImportedVscodeTheme | null> =>
      typeof id === 'string' ? readImportedTheme(themesDir(), id) : Promise.resolve(null)
  )
  ipcMain.handle('vscodeThemes:removeImported', (_event, id: unknown) =>
    typeof id === 'string' ? removeImportedTheme(themesDir(), id) : undefined
  )
}

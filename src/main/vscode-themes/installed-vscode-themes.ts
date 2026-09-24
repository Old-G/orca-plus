import { readdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { VscodeThemeBase } from '../../shared/vscode-theme/vscode-theme-types'
import { directoryThemeSource } from './theme-file-sources'
import { readExtensionManifest, type ThemeFileSource } from './vscode-theme-loader'

// Custom build (vscode-theme-import): themes already installed in Cursor or VS Code on this machine.

export type EditorWithThemes = 'cursor' | 'vscode'

export type InstalledThemeExtension = {
  editor: EditorWithThemes
  extensionId: string
  displayName: string
  version: string
  themes: { label: string; base: VscodeThemeBase }[]
}

type Found = InstalledThemeExtension & { source: ThemeFileSource }

const EXTENSION_ROOTS: readonly (readonly [EditorWithThemes, string])[] = [
  ['cursor', '.cursor'],
  ['vscode', '.vscode']
]

function compareVersions(a: string, b: string): number {
  const parts = (value: string): number[] => value.split(/[.-]/).map((part) => Number(part) || 0)
  const left = parts(a)
  const right = parts(b)
  for (let index = 0; index < Math.max(left.length, right.length); index++) {
    const diff = (left[index] ?? 0) - (right[index] ?? 0)
    if (diff !== 0) {
      return diff
    }
  }
  return 0
}

export async function findInstalledThemeExtensions(home = homedir()): Promise<Found[]> {
  const found = new Map<string, Found>()
  for (const [editor, folder] of EXTENSION_ROOTS) {
    const root = join(home, folder, 'extensions')
    const dirs = await readdir(root, { withFileTypes: true }).catch(() => [])
    for (const dir of dirs) {
      if (!dir.isDirectory()) {
        continue
      }
      const source = directoryThemeSource(join(root, dir.name))
      const manifest = await readExtensionManifest(source).catch(() => null)
      if (!manifest || manifest.themes.length === 0) {
        continue
      }
      const key = `${editor}:${manifest.id}`
      const previous = found.get(key)
      // Why: editors leave superseded versions on disk until cleanup; keep the newest.
      if (previous && compareVersions(previous.version, manifest.version) >= 0) {
        continue
      }
      found.set(key, {
        editor,
        extensionId: manifest.id,
        displayName: manifest.displayName,
        version: manifest.version,
        themes: manifest.themes.map(({ label, base }) => ({ label, base })),
        source
      })
    }
  }
  return [...found.values()].sort((a, b) => a.displayName.localeCompare(b.displayName))
}

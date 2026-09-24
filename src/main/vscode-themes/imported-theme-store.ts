import { createHash } from 'node:crypto'
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ImportedThemeSummary } from '../../shared/vscode-theme/vscode-theme-ipc'
import type {
  ImportedVscodeTheme,
  ResolvedVscodeTheme,
  VscodeThemeOrigin
} from '../../shared/vscode-theme/vscode-theme-types'

// Custom build (vscode-theme-import): imported themes are saved resolved (includes flattened) as
// <userData>/themes/<id>.json, so they keep working after the source extension is removed.

const THEME_ID_RE = /^[a-z0-9-]{1,80}$/

export function isImportedThemeId(value: unknown): value is string {
  return typeof value === 'string' && THEME_ID_RE.test(value)
}

function themeId(origin: VscodeThemeOrigin, label: string): string {
  const source = origin.kind === 'vsix-file' ? origin.fileName : origin.extensionId
  const slug = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60)
  const hash = createHash('sha1').update(`${source}\0${label}`).digest('hex').slice(0, 8)
  return `${slug || 'theme'}-${hash}`
}

function isImportedTheme(value: unknown): value is ImportedVscodeTheme {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const record: { id?: unknown; label?: unknown; colors?: unknown; tokenColors?: unknown } = value
  return (
    isImportedThemeId(record.id) &&
    typeof record.label === 'string' &&
    typeof record.colors === 'object' &&
    Array.isArray(record.tokenColors)
  )
}

export async function saveImportedTheme(
  dir: string,
  theme: ResolvedVscodeTheme,
  origin: VscodeThemeOrigin
): Promise<ImportedThemeSummary> {
  const imported: ImportedVscodeTheme = {
    ...theme,
    id: themeId(origin, theme.label),
    origin,
    importedAt: Date.now()
  }
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, `${imported.id}.json`), JSON.stringify(imported))
  return { id: imported.id, label: imported.label, base: imported.base, origin }
}

export async function readImportedTheme(
  dir: string,
  id: string
): Promise<ImportedVscodeTheme | null> {
  if (!isImportedThemeId(id)) {
    return null
  }
  const text = await readFile(join(dir, `${id}.json`), 'utf8').catch(() => null)
  const value: unknown = text ? JSON.parse(text) : null
  return isImportedTheme(value) ? value : null
}

export async function listImportedThemes(dir: string): Promise<ImportedThemeSummary[]> {
  const names = await readdir(dir).catch(() => [])
  const themes = await Promise.all(
    names
      .filter((name) => name.endsWith('.json'))
      .map((name) => readImportedTheme(dir, name.slice(0, -'.json'.length)).catch(() => null))
  )
  return themes
    .filter((theme): theme is ImportedVscodeTheme => theme !== null)
    .map(({ id, label, base, origin }) => ({ id, label, base, origin }))
    .sort((a, b) => a.label.localeCompare(b.label))
}

export async function removeImportedTheme(dir: string, id: string): Promise<void> {
  if (isImportedThemeId(id)) {
    await rm(join(dir, `${id}.json`), { force: true })
  }
}

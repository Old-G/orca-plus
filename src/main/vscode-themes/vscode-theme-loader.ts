import { posix } from 'node:path'
import { parse, type ParseError } from 'jsonc-parser'
import {
  toVscodeThemeBase,
  type ResolvedVscodeTheme,
  type VscodeThemeBase,
  type VscodeTokenColorRule
} from '../../shared/vscode-theme/vscode-theme-types'

// Custom build (vscode-theme-import): reads `contributes.themes` and resolves one theme file the
// way VS Code does — JSON with comments, `include` chains, `tokenColors` given as a file path.

/** Reads a file by its path relative to the extension root (posix, no leading "./"). */
export type ThemeFileSource = { readText: (path: string) => Promise<string | null> }

export type ExtensionThemeEntry = { label: string; base: VscodeThemeBase; path: string }

export type ExtensionManifest = {
  id: string
  displayName: string
  version: string
  themes: ExtensionThemeEntry[]
}

const MAX_INCLUDE_DEPTH = 10

export class VscodeThemeLoadError extends Error {}

function parseJsonc(text: string, path: string): unknown {
  const errors: ParseError[] = []
  const value: unknown = parse(text, errors, { allowTrailingComma: true, disallowComments: false })
  if (value === undefined || (errors.length > 0 && typeof value !== 'object')) {
    throw new VscodeThemeLoadError(`Could not parse ${path}`)
  }
  return value
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key]
  return typeof value === 'string' ? value : undefined
}

function normalizePath(path: string): string {
  return posix.normalize(path).replace(/^(\.\/)+/, '')
}

async function readJson(source: ThemeFileSource, path: string): Promise<unknown> {
  const text = await source.readText(path)
  if (text === null) {
    throw new VscodeThemeLoadError(`Missing ${path}`)
  }
  return parseJsonc(text, path)
}

export async function readExtensionManifest(source: ThemeFileSource): Promise<ExtensionManifest> {
  const manifest = await readJson(source, 'package.json')
  if (!isRecord(manifest)) {
    throw new VscodeThemeLoadError('package.json is not an object')
  }
  const nlsText = await source.readText('package.nls.json')
  const nls = nlsText ? parseJsonc(nlsText, 'package.nls.json') : null
  const localize = (value: string | undefined): string | undefined => {
    const key = value?.match(/^%(.+)%$/)?.[1]
    const localized = key && isRecord(nls) ? stringField(nls, key) : undefined
    return localized ?? value
  }
  const contributes = isRecord(manifest.contributes) ? manifest.contributes : {}
  const rawThemes = Array.isArray(contributes.themes) ? contributes.themes : []
  const themes = rawThemes.filter(isRecord).flatMap((theme): ExtensionThemeEntry[] => {
    const path = stringField(theme, 'path')
    const label = localize(stringField(theme, 'label') ?? stringField(theme, 'id'))
    return path && label
      ? [{ label, base: toVscodeThemeBase(theme.uiTheme), path: normalizePath(path) }]
      : []
  })
  const publisher = stringField(manifest, 'publisher') ?? 'unknown'
  const name = stringField(manifest, 'name') ?? 'unknown'
  return {
    id: `${publisher}.${name}`.toLowerCase(),
    displayName: localize(stringField(manifest, 'displayName')) ?? name,
    version: stringField(manifest, 'version') ?? '0.0.0',
    themes
  }
}

function isScope(value: unknown): value is string | string[] {
  return (
    typeof value === 'string' ||
    (Array.isArray(value) && value.every((entry) => typeof entry === 'string'))
  )
}

function toTokenColorRules(value: unknown): VscodeTokenColorRule[] {
  if (!Array.isArray(value)) {
    return []
  }
  return value.filter(isRecord).flatMap((rule): VscodeTokenColorRule[] => {
    if (!isRecord(rule.settings)) {
      return []
    }
    const scope = rule.scope
    return [
      {
        ...(isScope(scope) ? { scope } : {}),
        settings: {
          foreground: stringField(rule.settings, 'foreground'),
          background: stringField(rule.settings, 'background'),
          fontStyle: stringField(rule.settings, 'fontStyle')
        }
      }
    ]
  })
}

type ThemeLayer = {
  colors: Record<string, string>
  tokenColors: VscodeTokenColorRule[]
  name?: string
}

async function loadLayer(
  source: ThemeFileSource,
  path: string,
  seen: Set<string>
): Promise<ThemeLayer> {
  if (seen.has(path) || seen.size >= MAX_INCLUDE_DEPTH) {
    throw new VscodeThemeLoadError(`Include loop or chain too deep at ${path}`)
  }
  seen.add(path)
  const json = await readJson(source, path)
  if (!isRecord(json)) {
    throw new VscodeThemeLoadError(`${path} is not an object`)
  }
  const dir = posix.dirname(path)
  const include = stringField(json, 'include')
  const base: ThemeLayer = include
    ? await loadLayer(source, normalizePath(posix.join(dir, include)), seen)
    : { colors: {}, tokenColors: [] }

  let tokenColors = toTokenColorRules(json.tokenColors)
  const tokenColorsPath = stringField(json, 'tokenColors')
  if (tokenColorsPath && tokenColorsPath.endsWith('.json')) {
    const referenced = await readJson(source, normalizePath(posix.join(dir, tokenColorsPath)))
    tokenColors = toTokenColorRules(isRecord(referenced) ? referenced.tokenColors : referenced)
  }
  const colors: Record<string, string> = { ...base.colors }
  if (isRecord(json.colors)) {
    for (const [key, value] of Object.entries(json.colors)) {
      if (typeof value === 'string') {
        colors[key] = value
      }
    }
  }
  return {
    colors,
    tokenColors: [...base.tokenColors, ...tokenColors],
    name: stringField(json, 'name') ?? base.name
  }
}

export async function resolveExtensionTheme(
  source: ThemeFileSource,
  entry: ExtensionThemeEntry
): Promise<ResolvedVscodeTheme> {
  const layer = await loadLayer(source, entry.path, new Set())
  return {
    label: entry.label,
    base: entry.base,
    colors: layer.colors,
    tokenColors: layer.tokenColors
  }
}

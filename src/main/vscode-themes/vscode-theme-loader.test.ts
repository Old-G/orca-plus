import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { findInstalledThemeExtensions } from './installed-vscode-themes'
import { directoryThemeSource, vsixThemeSource } from './theme-file-sources'
import { buildTestZip } from './vsix-test-archive'
import { openVsixArchive } from './vsix-zip-reader'
import { readExtensionManifest, resolveExtensionTheme } from './vscode-theme-loader'

function writeTree(root: string, files: Record<string, string>): void {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), content)
  }
}

const EXTENSION = {
  'package.json': JSON.stringify({
    publisher: 'Acme',
    name: 'night',
    displayName: '%display%',
    version: '1.2.0',
    contributes: {
      themes: [
        { label: '%night.label%', uiTheme: 'vs-dark', path: './themes/night.json' },
        { label: 'Day', uiTheme: 'vs', path: './themes/day.json' }
      ]
    }
  }),
  'package.nls.json': JSON.stringify({ display: 'Acme Night', 'night.label': 'Night' }),
  // JSON with comments and a trailing comma, like many real themes.
  'themes/night.json': `{
    // base colors come from the include
    "include": "./base.json",
    "colors": { "editor.background": "#101010", },
    "tokenColors": [{ "scope": "string", "settings": { "foreground": "#aabbcc" } }]
  }`,
  'themes/base.json': JSON.stringify({
    colors: { 'editor.background': '#000000', 'editor.foreground': '#eeeeee' },
    tokenColors: [{ scope: ['comment', 'punctuation'], settings: { fontStyle: 'italic' } }]
  }),
  'themes/day.json': JSON.stringify({ colors: {}, tokenColors: './day-tokens.json' }),
  'themes/day-tokens.json': JSON.stringify({
    tokenColors: [{ scope: 'keyword', settings: { foreground: '#0000ff' } }]
  })
}

describe('VS Code theme loader', () => {
  let root: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'orca-vscode-theme-'))
  })

  afterEach(() => rmSync(root, { recursive: true, force: true }))

  it('reads the manifest with localized labels', async () => {
    writeTree(root, EXTENSION)
    const manifest = await readExtensionManifest(directoryThemeSource(root))
    expect(manifest).toMatchObject({
      id: 'acme.night',
      displayName: 'Acme Night',
      version: '1.2.0'
    })
    expect(manifest.themes).toEqual([
      { label: 'Night', base: 'vs-dark', path: 'themes/night.json' },
      { label: 'Day', base: 'vs', path: 'themes/day.json' }
    ])
  })

  it('resolves include chains, child colors winning and token rules appended', async () => {
    writeTree(root, EXTENSION)
    const source = directoryThemeSource(root)
    const [night] = (await readExtensionManifest(source)).themes
    const theme = await resolveExtensionTheme(source, night)
    expect(theme.colors).toEqual({ 'editor.background': '#101010', 'editor.foreground': '#eeeeee' })
    expect(theme.tokenColors.map((rule) => rule.scope)).toEqual([
      ['comment', 'punctuation'],
      'string'
    ])
  })

  it('loads tokenColors given as a file path', async () => {
    writeTree(root, EXTENSION)
    const source = directoryThemeSource(root)
    const day = (await readExtensionManifest(source)).themes[1]
    expect((await resolveExtensionTheme(source, day)).tokenColors).toEqual([
      { scope: 'keyword', settings: { foreground: '#0000ff' } }
    ])
  })

  it('stops include loops instead of hanging', async () => {
    writeTree(root, {
      'a.json': JSON.stringify({ include: './b.json' }),
      'b.json': JSON.stringify({ include: './a.json' })
    })
    await expect(
      resolveExtensionTheme(directoryThemeSource(root), {
        label: 'A',
        base: 'vs-dark',
        path: 'a.json'
      })
    ).rejects.toThrow(/loop/)
  })

  it('never reads outside the extension root', async () => {
    writeTree(root, { 'outside.json': '{}', 'ext/package.json': '{}' })
    const source = directoryThemeSource(join(root, 'ext'))
    expect(await source.readText('../outside.json')).toBeNull()
    expect(await source.readText('/etc/hosts')).toBeNull()
  })

  it('reads the same extension from a .vsix', async () => {
    const zipFiles = Object.fromEntries(
      Object.entries(EXTENSION).map(([path, content]) => [`extension/${path}`, content])
    )
    const source = vsixThemeSource(openVsixArchive(buildTestZip(zipFiles)))
    const manifest = await readExtensionManifest(source)
    const theme = await resolveExtensionTheme(source, manifest.themes[0])
    expect(theme.colors['editor.background']).toBe('#101010')
  })

  it('finds installed Cursor and VS Code themes, newest version only', async () => {
    const manifest = (version: string): string =>
      JSON.stringify({ ...JSON.parse(EXTENSION['package.json']), version })
    writeTree(root, {
      '.cursor/extensions/acme.night-1.0.0/package.json': manifest('1.0.0'),
      '.cursor/extensions/acme.night-1.10.0/package.json': manifest('1.10.0'),
      '.cursor/extensions/acme.night-1.10.0/package.nls.json': EXTENSION['package.nls.json'],
      '.vscode/extensions/other.lang-1.0.0/package.json': JSON.stringify({ name: 'lang' })
    })
    const found = await findInstalledThemeExtensions(root)
    expect(
      found.map(({ editor, extensionId, version }) => ({ editor, extensionId, version }))
    ).toEqual([{ editor: 'cursor', extensionId: 'acme.night', version: '1.10.0' }])
    expect(found[0].themes.map((theme) => theme.label)).toEqual(['Night', 'Day'])
  })
})

import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  listImportedThemes,
  readImportedTheme,
  removeImportedTheme,
  saveImportedTheme
} from './imported-theme-store'

const THEME = {
  label: 'Hub Contrast (rainglow)',
  base: 'vs-dark' as const,
  colors: {},
  tokenColors: []
}
const ORIGIN = { kind: 'open-vsx' as const, extensionId: 'daylerees.rainglow', version: '1.5.2' }

describe('imported theme store', () => {
  let dir: string

  beforeEach(() => {
    dir = join(mkdtempSync(join(tmpdir(), 'orca-themes-')), 'themes')
  })

  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('saves a stable id per source and label, and reads it back', async () => {
    const saved = await saveImportedTheme(dir, THEME, ORIGIN)
    expect(saved.id).toMatch(/^hub-contrast-rainglow-[0-9a-f]{8}$/)
    expect((await saveImportedTheme(dir, THEME, ORIGIN)).id).toBe(saved.id)
    expect(await readImportedTheme(dir, saved.id)).toMatchObject({ ...THEME, origin: ORIGIN })
    expect(await listImportedThemes(dir)).toEqual([
      { id: saved.id, label: THEME.label, base: 'vs-dark', origin: ORIGIN }
    ])
  })

  it('ignores ids that could escape the folder and files that are not themes', async () => {
    const saved = await saveImportedTheme(dir, THEME, ORIGIN)
    writeFileSync(join(dir, 'junk.json'), '{"hello":1}')
    expect(await readImportedTheme(dir, '../themes/x')).toBeNull()
    expect((await listImportedThemes(dir)).map((theme) => theme.id)).toEqual([saved.id])
    await removeImportedTheme(dir, '../../etc')
    await removeImportedTheme(dir, saved.id)
    expect(readdirSync(dir)).toEqual(['junk.json'])
  })
})

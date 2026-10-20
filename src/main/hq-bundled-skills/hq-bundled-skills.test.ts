import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { HQ_SKILL_MARKER, syncBundledHqSkills, writeHqPathPointer } from './hq-bundled-skills'

let root: string
let source: string
let target: string

async function skill(base: string, name: string, files: Record<string, string>): Promise<void> {
  for (const [path, text] of Object.entries(files)) {
    await mkdir(join(base, name, path, '..'), { recursive: true })
    await writeFile(join(base, name, path), text)
  }
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'hq-skills-'))
  source = join(root, 'bundle')
  target = join(root, 'claude-skills')
  await skill(source, 'ask-hq', { 'SKILL.md': 'ask v1' })
  await skill(source, 'hq-setup', { 'SKILL.md': 'setup', 'hq_location.py': 'print(1)' })
  await chmod(join(source, 'hq-setup', 'hq_location.py'), 0o755)
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('syncBundledHqSkills', () => {
  it('installs every bundled skill with a marker and keeps the executable bit', async () => {
    const result = await syncBundledHqSkills(source, target)
    expect(result.installed).toEqual(['ask-hq', 'hq-setup'])
    expect(await readFile(join(target, 'ask-hq', 'SKILL.md'), 'utf8')).toBe('ask v1')
    const marker = JSON.parse(await readFile(join(target, 'ask-hq', HQ_SKILL_MARKER), 'utf8'))
    expect(marker).toMatchObject({ source: 'orca-plus', skill: 'ask-hq' })
    expect((await stat(join(target, 'hq-setup', 'hq_location.py'))).mode & 0o111).not.toBe(0)
  })

  it('leaves unchanged copies alone and replaces a copy whose bundle changed', async () => {
    await syncBundledHqSkills(source, target)
    await writeFile(join(source, 'ask-hq', 'SKILL.md'), 'ask v2')
    const result = await syncBundledHqSkills(source, target)
    expect(result.updated).toEqual(['ask-hq'])
    expect(result.unchanged).toEqual(['hq-setup'])
    expect(await readFile(join(target, 'ask-hq', 'SKILL.md'), 'utf8')).toBe('ask v2')
  })

  it('touches nothing when the owner keeps a bundled skill of their own', async () => {
    await skill(target, 'ask-hq', { 'SKILL.md': 'my own' })
    const result = await syncBundledHqSkills(source, target)
    expect(result.handManagedBy).toBe('ask-hq')
    expect(result.installed).toEqual([])
    expect(await readFile(join(target, 'ask-hq', 'SKILL.md'), 'utf8')).toBe('my own')
    await expect(stat(join(target, 'hq-setup'))).rejects.toThrow()
  })

  it('removes a copy it placed once the bundle drops it, never a foreign folder', async () => {
    await syncBundledHqSkills(source, target)
    await skill(target, 'my-skill', { 'SKILL.md': 'mine' })
    await rm(join(source, 'ask-hq'), { recursive: true })
    const result = await syncBundledHqSkills(source, target)
    expect(result.removed).toEqual(['ask-hq'])
    await expect(stat(join(target, 'ask-hq'))).rejects.toThrow()
    expect(await readFile(join(target, 'my-skill', 'SKILL.md'), 'utf8')).toBe('mine')
  })

  it('does not copy Python caches', async () => {
    await skill(source, 'hq-setup', { '__pycache__/hq_location.cpython-314.pyc': 'x' })
    await syncBundledHqSkills(source, target)
    await expect(stat(join(target, 'hq-setup', '__pycache__'))).rejects.toThrow()
  })
})

describe('writeHqPathPointer', () => {
  it('writes the HQ folder for the skills to read, creating the folder', async () => {
    const pointer = join(root, 'config', 'orca-plus', 'hq.json')
    await writeHqPathPointer(pointer, '/Users/me/HQ')
    expect(JSON.parse(await readFile(pointer, 'utf8'))).toEqual({ hqPath: '/Users/me/HQ' })
    await writeHqPathPointer(pointer, null)
    expect(JSON.parse(await readFile(pointer, 'utf8'))).toEqual({ hqPath: null })
  })
})

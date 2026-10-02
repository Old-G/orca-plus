import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { listHqWikiEntries, readHqWikiPage } from './hq-wiki-files'

let root: string
let hq: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'hq-wiki-'))
  hq = join(root, 'hq')
  for (const dir of [
    'wiki',
    'projects/_archive',
    'chats/work',
    '.git',
    'scripts',
    'page-templates'
  ]) {
    mkdirSync(join(hq, dir), { recursive: true })
  }
  writeFileSync(join(hq, 'CLAUDE.md'), '# HQ\n')
  writeFileSync(join(hq, 'wiki', 'index.md'), '# Index\n')
  writeFileSync(join(hq, 'projects', 'shop.md'), '---\nproject: shop\n---\n\n# Shop — store\n')
  writeFileSync(join(hq, 'projects', 'untitled.md'), 'no heading\n')
  writeFileSync(join(hq, 'projects', '_archive', 'old.md'), '# Old\n')
  writeFileSync(join(hq, 'chats', 'work', 'CLAUDE.md'), '# Chat\n')
  writeFileSync(join(hq, '.git', 'notes.md'), '# Git\n')
  writeFileSync(join(hq, 'scripts', 'README.md'), '# Scripts\n')
  writeFileSync(join(hq, 'page-templates', 'project.md'), '# <Display name>\n')
  writeFileSync(join(root, 'secret.md'), '# Outside\n')
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('listHqWikiEntries', () => {
  it('lists the pages with their headings, skipping chats, scripts, templates, git and the archive', async () => {
    expect(await listHqWikiEntries(hq)).toEqual([
      { path: 'CLAUDE.md', title: 'HQ' },
      { path: 'projects/shop.md', title: 'Shop — store' },
      { path: 'projects/untitled.md', title: 'untitled' },
      { path: 'wiki/index.md', title: 'Index' }
    ])
  })
})

describe('readHqWikiPage', () => {
  it('reads a page inside HQ', async () => {
    expect(await readHqWikiPage(hq, 'wiki/index.md')).toBe('# Index\n')
  })

  it('refuses anything outside HQ or not markdown', async () => {
    symlinkSync(join(root, 'secret.md'), join(hq, 'wiki', 'link.md'))
    await expect(readHqWikiPage(hq, '../secret.md')).rejects.toThrow('Not an HQ page.')
    await expect(readHqWikiPage(hq, 'wiki/link.md')).rejects.toThrow('Not an HQ page.')
    await expect(readHqWikiPage(hq, 'hq.yaml')).rejects.toThrow('Not an HQ page.')
  })
})

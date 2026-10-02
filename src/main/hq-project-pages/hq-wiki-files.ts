// Custom build (hq): the HQ folder's markdown pages, for the HQ Wiki tab — listed with their first
// heading, read one at a time, and never outside the folder.
import { readdir, readFile, realpath, stat } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'
import type { HqWikiEntry } from '../../shared/hq-project-pages'

/** Generated or private corners of HQ that are not pages to read. */
const SKIPPED_DIRS = new Set([
  '.git',
  '.strata',
  'chats',
  'node_modules',
  'page-templates',
  'scripts',
  '_archive'
])
const MAX_ENTRIES = 2000
const MAX_DEPTH = 4
const MAX_PAGE_BYTES = 2 * 1024 * 1024

function headingOf(markdown: string): string | null {
  const body = markdown.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, '')
  const match = /^# (.+)$/m.exec(body)
  return match ? match[1].trim() : null
}

export async function listHqWikiEntries(hqPath: string): Promise<HqWikiEntry[]> {
  const entries: HqWikiEntry[] = []
  const walk = async (dir: string, depth: number): Promise<void> => {
    if (depth > MAX_DEPTH || entries.length >= MAX_ENTRIES) {
      return
    }
    const children = (await readdir(dir, { withFileTypes: true })).sort((a, b) =>
      a.name.localeCompare(b.name)
    )
    for (const child of children) {
      if (entries.length >= MAX_ENTRIES) {
        return
      }
      const full = join(dir, child.name)
      if (child.isDirectory()) {
        if (!SKIPPED_DIRS.has(child.name) && !child.name.startsWith('.')) {
          await walk(full, depth + 1)
        }
      } else if (child.isFile() && child.name.endsWith('.md')) {
        const path = relative(hqPath, full).split(sep).join('/')
        const text = await readFile(full, 'utf8')
        entries.push({ path, title: headingOf(text) ?? child.name.replace(/\.md$/, '') })
      }
    }
  }
  await walk(hqPath, 0)
  return entries
}

/** A page by its HQ-relative path; refuses anything that is not a markdown file inside HQ. */
export async function readHqWikiPage(hqPath: string, relativePath: string): Promise<string> {
  if (!relativePath.endsWith('.md') || relativePath.split(/[\\/]/).includes('..')) {
    throw new Error('Not an HQ page.')
  }
  const root = await realpath(hqPath)
  const target = await realpath(join(hqPath, relativePath))
  if (!target.startsWith(root + sep)) {
    throw new Error('Not an HQ page.')
  }
  if ((await stat(target)).size > MAX_PAGE_BYTES) {
    throw new Error('This page is too large to show.')
  }
  return readFile(target, 'utf8')
}

// Custom build (hq): reads HQ's project pages — frontmatter plus the first heading of each.
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { HqProjectPage } from '../../shared/hq-project-pages'

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/

/** The top-level `key: value` lines; read by line so one malformed line spoils only itself. */
function frontmatterFields(block: string): Map<string, string> {
  const fields = new Map<string, string>()
  for (const line of block.split(/\r?\n/)) {
    const match = /^([A-Za-z_][\w-]*):[ \t]*(.*?)[ \t]*$/.exec(line)
    if (match && match[2] && match[2] !== 'null') {
      fields.set(match[1], match[2].replace(/^(["'])(.*)\1$/, '$2'))
    }
  }
  return fields
}

/** `[a, b]` → its slugs; a template's unfilled `<…>` placeholder is no slug. */
function readRelations(value: string | undefined): string[] {
  const inner = value?.trim().replace(/^\[/, '').replace(/\]$/, '') ?? ''
  return inner
    .split(',')
    .map((slug) => slug.trim().replace(/^(["'])(.*)\1$/, '$2'))
    .filter((slug) => slug.length > 0 && !slug.startsWith('<'))
}

/** Null for a page without the `id` and `project` an HQ sync writes. */
export function readHqProjectPage(markdown: string): HqProjectPage | null {
  const match = FRONTMATTER.exec(markdown)
  if (!match) {
    return null
  }
  const fields = frontmatterFields(match[1])
  const repoId = fields.get('id')
  const slug = fields.get('project')
  if (!repoId || !slug) {
    return null
  }
  const heading = /^# (.+)$/m.exec(markdown.slice(match[0].length))
  return {
    repoId,
    slug,
    title: heading ? heading[1].trim() : null,
    status: fields.get('status') ?? null,
    group: fields.get('group') ?? null,
    relations: readRelations(fields.get('relations'))
  }
}

export async function listHqProjectPages(hqPath: string): Promise<HqProjectPage[]> {
  const dir = join(hqPath, 'projects')
  const names = (await readdir(dir)).filter((name) => name.endsWith('.md')).sort()
  const pages = await Promise.all(
    names.map(async (name) => readHqProjectPage(await readFile(join(dir, name), 'utf8')))
  )
  return pages.filter((page): page is HqProjectPage => page !== null)
}

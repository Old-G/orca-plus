// Custom build (hq): reads HQ's project pages — frontmatter plus the first heading of each.
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { HQ_AUTONOMY_FILE, hqAutonomyFor, parseHqAutonomy } from '../../shared/hq-autonomy'
import type { HqProjectPage } from '../../shared/hq-project-pages'

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/

/** Custom build (hq-plus-context): a page's top-level frontmatter fields; empty without frontmatter. */
export function readHqProjectPageFields(markdown: string): Map<string, string> {
  const match = FRONTMATTER.exec(markdown)
  return match ? frontmatterFields(match[1]) : new Map()
}

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
  const body = markdown.slice(match[0].length)
  const heading = /^# (.+)$/m.exec(body)
  return {
    repoId,
    slug,
    title: heading ? heading[1].trim() : null,
    status: fields.get('status') ?? null,
    group: fields.get('group') ?? null,
    relations: readRelations(fields.get('relations')),
    ...withSummary(pageSummary(body))
  }
}

/** Why the first two sentences: the rest of «Кратко» is history, not what the project is for. */
const SUMMARY_CHARS = 280

const withSummary = (summary: string | null): { summary?: string } => (summary ? { summary } : {})

function pageSummary(body: string): string | null {
  // Why no `m` flag: with it `$` ends the capture at the first line of a wrapped «Кратко».
  // Why \u escapes: this file lands in the orcad bundle, which must stay pure ASCII
  // (orcad-entry-build rejects any char >= 0x80); the escapes spell «Кратко».
  const section =
    /(?:^|\n)## (?:\u041a\u0440\u0430\u0442\u043a\u043e|Summary)[ \t]*\n+([\s\S]*?)(?=\n## |$)/.exec(
      body
    )?.[1]
  const text = section?.replace(/\s+/g, ' ').trim()
  if (!text) {
    return null
  }
  const sentences = text
    .split(/(?<=[.!?])\s+/)
    .slice(0, 2)
    .join(' ')
  return sentences.slice(0, SUMMARY_CHARS)
}

export async function listHqProjectPages(hqPath: string): Promise<HqProjectPage[]> {
  const dir = join(hqPath, 'projects')
  const names = (await readdir(dir)).filter((name) => name.endsWith('.md')).sort()
  const pages = await Promise.all(
    names.map(async (name) => readHqProjectPage(await readFile(join(dir, name), 'utf8')))
  )
  // Custom build (hq-autonomy): a missing file means every project gets the fallback level.
  const autonomy = parseHqAutonomy(
    await readFile(join(hqPath, HQ_AUTONOMY_FILE), 'utf8').catch(() => null)
  )
  return pages
    .filter((page): page is HqProjectPage => page !== null)
    .map((page) => ({ ...page, autonomy: hqAutonomyFor(autonomy, page.slug) }))
}

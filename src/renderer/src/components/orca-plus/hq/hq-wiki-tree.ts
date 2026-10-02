// Custom build (hq): how the HQ Wiki tab lays out the folder's pages and follows links between them.
import type { HqWikiEntry } from '../../../../../shared/hq-project-pages'

export type HqWikiSection = { id: string; entries: HqWikiEntry[] }

/** HQ's own reading order (its CLAUDE.md): the index first, then projects, groups and the rest. */
const SECTION_ORDER = ['wiki', 'projects', 'groups', 'decisions', 'people', 'ideas', 'plans']
export const HQ_WIKI_ROOT_SECTION = '.'
export const HQ_WIKI_HOME = 'wiki/index.md'

function sectionOf(path: string): string {
  const slash = path.indexOf('/')
  return slash === -1 ? HQ_WIKI_ROOT_SECTION : path.slice(0, slash)
}

export function buildHqWikiSections(
  entries: readonly HqWikiEntry[],
  filter: string
): HqWikiSection[] {
  const needle = filter.trim().toLocaleLowerCase()
  const bySection = new Map<string, HqWikiEntry[]>()
  for (const entry of entries) {
    if (
      needle &&
      !entry.title.toLocaleLowerCase().includes(needle) &&
      !entry.path.toLocaleLowerCase().includes(needle)
    ) {
      continue
    }
    const id = sectionOf(entry.path)
    bySection.set(id, [...(bySection.get(id) ?? []), entry])
  }
  const rank = (id: string): number => {
    const index = SECTION_ORDER.indexOf(id)
    return index === -1 ? SECTION_ORDER.length + (id === HQ_WIKI_ROOT_SECTION ? 1 : 0) : index
  }
  return [...bySection.entries()]
    .sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b))
    .map(([id, sectionEntries]) => ({
      id,
      entries: [...sectionEntries].sort((a, b) =>
        a.path.endsWith('/index.md') !== b.path.endsWith('/index.md')
          ? a.path.endsWith('/index.md')
            ? -1
            : 1
          : a.title.localeCompare(b.title)
      )
    }))
}

/** The HQ page a link on `fromPath` points to, or null for anything that is not an HQ page. */
export function resolveHqWikiLink(fromPath: string, href: string | undefined): string | null {
  const target = href?.trim().split('#')[0] ?? ''
  if (!target || /^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('//')) {
    return null
  }
  const decoded = decodeURIComponent(target)
  const parts = decoded.startsWith('/') ? [] : fromPath.split('/').slice(0, -1)
  for (const part of decoded.split('/')) {
    if (part === '..') {
      if (parts.length === 0) {
        return null
      }
      parts.pop()
    } else if (part && part !== '.') {
      parts.push(part)
    }
  }
  const path = parts.join('/')
  return path.endsWith('.md') ? path : null
}

/** The body a page shows: its YAML frontmatter is HQ's bookkeeping, not prose. */
export function hqWikiBody(markdown: string): string {
  return markdown.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, '')
}

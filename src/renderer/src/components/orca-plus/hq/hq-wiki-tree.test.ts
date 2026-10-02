import { describe, expect, it } from 'vitest'
import { buildHqWikiSections, hqWikiBody, resolveHqWikiLink } from './hq-wiki-tree'

const ENTRIES = [
  { path: 'CLAUDE.md', title: 'HQ' },
  { path: 'decisions/ship.md', title: 'Ship Monday' },
  { path: 'projects/shop.md', title: 'Shop' },
  { path: 'projects/api.md', title: 'API' },
  { path: 'wiki/log.md', title: 'Log' },
  { path: 'wiki/index.md', title: 'Index' },
  { path: 'zeta/x.md', title: 'X' }
]

describe('buildHqWikiSections', () => {
  it('orders sections the way HQ is read, index first, and root files after the known ones', () => {
    expect(
      buildHqWikiSections(ENTRIES, '').map((section) => [
        section.id,
        section.entries.map((entry) => entry.title)
      ])
    ).toEqual([
      ['wiki', ['Index', 'Log']],
      ['projects', ['API', 'Shop']],
      ['decisions', ['Ship Monday']],
      ['zeta', ['X']],
      ['.', ['HQ']]
    ])
  })

  it('filters by title or path', () => {
    expect(
      buildHqWikiSections(ENTRIES, 'SHO').flatMap((s) => s.entries.map((e) => e.path))
    ).toEqual(['projects/shop.md'])
  })
})

describe('resolveHqWikiLink', () => {
  it('follows relative, parent and root links to HQ pages', () => {
    expect(resolveHqWikiLink('wiki/index.md', '../projects/shop.md')).toBe('projects/shop.md')
    expect(resolveHqWikiLink('projects/shop.md', 'api.md#stack')).toBe('projects/api.md')
    expect(resolveHqWikiLink('projects/shop.md', '/decisions/ship.md')).toBe('decisions/ship.md')
    expect(resolveHqWikiLink('wiki/index.md', 'a%20b.md')).toBe('wiki/a b.md')
  })

  it('leaves web links, other files and escapes out of HQ alone', () => {
    expect(resolveHqWikiLink('wiki/index.md', 'https://example.com/a.md')).toBeNull()
    expect(resolveHqWikiLink('wiki/index.md', 'mailto:x@y.z')).toBeNull()
    expect(resolveHqWikiLink('wiki/index.md', '../hq.yaml')).toBeNull()
    expect(resolveHqWikiLink('wiki/index.md', '../../outside.md')).toBeNull()
    expect(resolveHqWikiLink('wiki/index.md', '#top')).toBeNull()
  })
})

describe('hqWikiBody', () => {
  it('drops the frontmatter and keeps the prose', () => {
    expect(hqWikiBody('---\nproject: shop\n---\n# Shop\n')).toBe('# Shop\n')
    expect(hqWikiBody('# Plain\n')).toBe('# Plain\n')
  })
})

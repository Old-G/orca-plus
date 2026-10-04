import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { listHqProjectPages, readHqProjectPage } from './hq-project-pages'

const PAGE = `---
project: shop
id: repo-1
status: active
group: Work
relations: [billing, "api"]
---

# Shop — the storefront

Body text.
`

describe('readHqProjectPage', () => {
  it('reads the repo id, slug, status and first heading', () => {
    expect(readHqProjectPage(PAGE)).toEqual({
      repoId: 'repo-1',
      slug: 'shop',
      title: 'Shop — the storefront',
      status: 'active',
      group: 'Work',
      relations: ['billing', 'api']
    })
  })

  it('skips pages without frontmatter, an id or a slug', () => {
    expect(readHqProjectPage('# Just a note\n')).toBeNull()
    expect(readHqProjectPage('---\nproject: shop\n---\n# Shop\n')).toBeNull()
    expect(readHqProjectPage('---\nid: repo-1\nproject: null\n---\n# Shop\n')).toBeNull()
  })

  it('reads a page whose other fields are not valid YAML, and unquotes values', () => {
    const page = [
      '---',
      'project: "shop"',
      "id: 'repo-1'",
      'stack: <one line: language · framework>',
      'relations: [<slugs: of others>]',
      '---',
      '# Shop — <what it is>',
      ''
    ].join('\n')
    expect(readHqProjectPage(page)).toEqual({
      repoId: 'repo-1',
      slug: 'shop',
      title: 'Shop — <what it is>',
      status: null,
      group: null,
      relations: []
    })
  })

  it('leaves title and status empty when the page has neither', () => {
    expect(readHqProjectPage('---\nid: repo-2\nproject: api\n---\nNo heading.\n')).toEqual({
      repoId: 'repo-2',
      slug: 'api',
      title: null,
      status: null,
      group: null,
      relations: []
    })
  })
})

describe('listHqProjectPages', () => {
  let dir: string | null = null
  afterEach(() => {
    if (dir) {
      rmSync(dir, { recursive: true, force: true })
    }
    dir = null
  })

  it('reads every markdown page under projects/, dropping the ones that are not project pages', async () => {
    dir = mkdtempSync(join(tmpdir(), 'hq-pages-'))
    mkdirSync(join(dir, 'projects', '_archive'), { recursive: true })
    writeFileSync(join(dir, 'projects', 'shop.md'), PAGE)
    writeFileSync(join(dir, 'projects', 'notes.md'), '# Not a project\n')
    writeFileSync(join(dir, 'projects', '.gitkeep'), '')
    expect(await listHqProjectPages(dir)).toEqual([
      {
        repoId: 'repo-1',
        slug: 'shop',
        title: 'Shop — the storefront',
        status: 'active',
        group: 'Work',
        relations: ['billing', 'api'],
        autonomy: 1
      }
    ])
  })

  it('gives each page its level from autonomy.yaml', async () => {
    dir = mkdtempSync(join(tmpdir(), 'hq-pages-'))
    mkdirSync(join(dir, 'projects'))
    writeFileSync(join(dir, 'projects', 'shop.md'), PAGE)
    writeFileSync(join(dir, 'projects', 'api.md'), '---\nid: repo-2\nproject: api\n---\n# Api\n')
    writeFileSync(join(dir, 'autonomy.yaml'), 'default: 2\nprojects:\n  shop: 0\n')
    const pages = await listHqProjectPages(dir)
    expect(pages.map((page) => [page.slug, page.autonomy])).toEqual([
      ['api', 2],
      ['shop', 0]
    ])
  })

  it('fails when the HQ folder has no projects/ directory', async () => {
    dir = mkdtempSync(join(tmpdir(), 'hq-pages-'))
    await expect(listHqProjectPages(dir)).rejects.toThrow()
  })
})

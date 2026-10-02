import { describe, expect, it } from 'vitest'
import type { HqProjectPage } from '../../shared/hq-project-pages'
import { buildHqProjectMap, type HqProjectMapDocument } from './hq-project-map-layout'

function page(slug: string, overrides: Partial<HqProjectPage> = {}): HqProjectPage {
  return {
    repoId: `id-${slug}`,
    slug,
    title: `${slug} — what ${slug} does`,
    status: 'active',
    group: 'Work',
    relations: [],
    ...overrides
  }
}

type Box = { id: string; x: number; y: number; w: number; h: number }

function boxes(doc: HqProjectMapDocument): Box[] {
  return doc.components.map((c) => ({
    id: c.id,
    x: c.pos[0],
    y: c.pos[1],
    w: c.size[0],
    h: c.size[1]
  }))
}

/** Does the axis-aligned segment pass through the inside of the box? */
function crosses(box: Box, [x1, y1]: number[], [x2, y2]: number[]): boolean {
  const [left, right] = [Math.min(x1, x2), Math.max(x1, x2)]
  const [top, bottom] = [Math.min(y1, y2), Math.max(y1, y2)]
  return left < box.x + box.w && right > box.x && top < box.y + box.h && bottom > box.y
}

const PAGES: HqProjectPage[] = [
  page('api', { relations: ['pay', 'web', 'ghost'] }),
  page('pay', { relations: ['api'], status: 'quiet' }),
  page('web', { relations: ['api', 'brain'] }),
  page('docs', { group: 'Work', relations: ['brain'] }),
  page('cli'),
  page('ops'),
  page('brain', { group: 'Lab', relations: ['web', 'tools'] }),
  page('tools', { group: 'Lab', title: 'tools — <what it is>' }),
  page('notes', { group: null, status: null, relations: ['api'] })
]

describe('buildHqProjectMap', () => {
  it('is deterministic: the same pages give the same JSON', () => {
    const one = buildHqProjectMap({ pages: PAGES, groupOrder: ['Lab', 'Work'] })
    const two = buildHqProjectMap({ pages: PAGES.toReversed(), groupOrder: ['Lab', 'Work'] })
    expect(JSON.stringify(one)).toBe(JSON.stringify(two))
  })

  it('draws a region per group in Orca order with ungrouped last, and one line per relation', () => {
    const doc = buildHqProjectMap({ pages: PAGES, groupOrder: ['Lab', 'Work'] })
    expect(doc.boundaries.map((b) => b.label)).toEqual(['Lab', 'Work', 'Other projects'])
    const lines = doc.connections.map((c) => [c.from, c.to].sort().join('+'))
    expect(lines.sort()).toEqual([
      'api+notes',
      'api+pay',
      'api+web',
      'brain+docs',
      'brain+tools',
      'brain+web'
    ])
  })

  it('colours boxes by status and drops a template placeholder summary', () => {
    const { components } = buildHqProjectMap({ pages: PAGES, groupOrder: [] })
    const byId = new Map(components.map((c) => [c.id, c]))
    expect(byId.get('api')).toMatchObject({ type: 'backend', sublabel: 'what api does' })
    expect(byId.get('pay')?.type).toBe('external')
    expect(byId.get('notes')?.type).toBe('cloud')
    expect(byId.get('tools')?.sublabel).toBeUndefined()
  })

  // Why: fifteen projects make three rows, so lines also take the vertical corridors.
  const DENSE = Array.from({ length: 15 }, (_, i) =>
    page(`p${i}`, { group: 'Big', relations: [`p${(i + 7) % 15}`, `p${(i + 11) % 15}`] })
  )

  it.each([
    ['grouped pages', PAGES],
    ['a dense group', [...DENSE, page('solo', { group: null, relations: ['p3'] })]]
  ])(
    'routes every line of %s from its box bottom without crossing any other box',
    (_name, pages) => {
      const doc = buildHqProjectMap({ pages, groupOrder: ['Lab', 'Work'] })
      const all = boxes(doc)
      const multiRow = doc.connections.some((c) => c.via.length === 4)
      expect(multiRow || pages === PAGES).toBe(true)
      for (const connection of doc.connections) {
        const from = all.find((box) => box.id === connection.from)
        const to = all.find((box) => box.id === connection.to)
        expect(from && to).toBeTruthy()
        if (!from || !to) {
          continue
        }
        const points = [
          [from.x + from.w / 2, from.y + from.h],
          ...connection.via,
          [to.x + to.w / 2, connection.via.at(-1)?.[1] ?? 0]
        ]
        for (let i = 0; i < points.length - 1; i++) {
          for (const box of all) {
            if (box.id !== from.id && box.id !== to.id) {
              expect(
                crosses(box, points[i], points[i + 1]),
                `${connection.from}→${connection.to} through ${box.id}`
              ).toBe(false)
            }
          }
        }
      }
    }
  )
})

// Custom build (hq): HQ's projects as one Archify architecture diagram — a box per project, a region
// per project group, a line per relation the project pages name. Archify's auto-router crosses
// unrelated boxes at this density, so every line is routed here through the gaps between rows and
// columns, each on its own lane. The output is deterministic: same pages, same JSON.
import type { HqProjectPage } from '../../shared/hq-project-pages'

const COLS = 5
const NODE_W = 210
const NODE_H = 56
const LANE_STEP = 8
/** First lane below a row inside a group, and below a group's last row (clear of its border). */
const LANE_START = 12
const LANE_START_GROUP_END = 40
const GROUP_TITLE_SPACE = 58
const TOP = 54
const SUMMARY_MAX = 26
const OTHER_GROUP = 'Other projects'

type Slot = { row: number; col: number }
type Edge = { from: string; to: string }

type Point = [number, number]

export type HqMapComponent = {
  id: string
  type: 'backend' | 'external' | 'cloud'
  label: string
  sublabel?: string
  pos: Point
  size: Point
}

export type HqMapConnection = {
  id: string
  from: string
  to: string
  fromSide: 'bottom'
  toSide: 'top' | 'bottom'
  via: Point[]
}

/** The Archify architecture IR, narrowed to what this map writes. */
export type HqProjectMapDocument = {
  schema_version: 1
  diagram_type: 'architecture'
  meta: Record<string, unknown>
  components: HqMapComponent[]
  boundaries: { kind: 'region'; label: string; wraps: string[] }[]
  connections: HqMapConnection[]
}

export type HqProjectMapInput = {
  pages: readonly HqProjectPage[]
  /** Group names in the order Orca shows them; groups not listed follow, ungrouped last. */
  groupOrder: readonly string[]
}

function componentId(slug: string): string {
  return slug.toLowerCase().replace(/[^a-z0-9-]/g, '-')
}

function summaryOf(page: HqProjectPage): string | null {
  const title = page.title ?? ''
  const dash = title.indexOf(' — ')
  const summary = dash === -1 ? '' : title.slice(dash + 3).trim()
  if (!summary || (summary.startsWith('<') && summary.endsWith('>'))) {
    return null
  }
  return summary.length > SUMMARY_MAX ? `${summary.slice(0, SUMMARY_MAX - 1).trimEnd()}…` : summary
}

function componentType(status: string | null): 'backend' | 'external' | 'cloud' {
  return status === 'active' ? 'backend' : status === 'quiet' ? 'external' : 'cloud'
}

function orderedGroups(input: HqProjectMapInput): { name: string; pages: HqProjectPage[] }[] {
  const byGroup = new Map<string, HqProjectPage[]>()
  for (const page of [...input.pages].sort((a, b) => a.slug.localeCompare(b.slug))) {
    const name = page.group ?? OTHER_GROUP
    byGroup.set(name, [...(byGroup.get(name) ?? []), page])
  }
  const rank = (name: string): number => {
    if (name === OTHER_GROUP) {
      return Number.POSITIVE_INFINITY
    }
    const index = input.groupOrder.indexOf(name)
    return index === -1 ? input.groupOrder.length : index
  }
  return [...byGroup.entries()]
    .sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b))
    .map(([name, pages]) => ({ name, pages }))
}

function relationEdges(pages: readonly HqProjectPage[]): Edge[] {
  const slugs = new Set(pages.map((page) => page.slug))
  const keys = new Set<string>()
  for (const page of pages) {
    for (const other of page.relations) {
      if (other !== page.slug && slugs.has(other)) {
        keys.add([page.slug, other].sort().join('\u0000'))
      }
    }
  }
  return [...keys].sort().map((key) => {
    const [from, to] = key.split('\u0000')
    return { from, to }
  })
}

/** Slots per project: each group fills whole rows; swaps inside a group shorten the lines. */
function placeProjects(
  groups: ReturnType<typeof orderedGroups>,
  edges: readonly Edge[]
): { slots: Map<string, Slot>; groupRows: { name: string; rows: number[] }[] } {
  const slots = new Map<string, Slot>()
  const groupRows: { name: string; rows: number[] }[] = []
  const groupCells: (string | null)[][] = []
  let row = 0
  for (const group of groups) {
    const rows = Math.ceil(group.pages.length / COLS)
    const cells: (string | null)[] = Array.from({ length: rows * COLS }, (_, index) =>
      index < group.pages.length ? group.pages[index].slug : null
    )
    groupCells.push(cells)
    groupRows.push({ name: group.name, rows: Array.from({ length: rows }, (_, i) => row + i) })
    row += rows
  }
  const place = (): void => {
    groupCells.forEach((cells, groupIndex) => {
      const firstRow = groupRows[groupIndex].rows[0]
      cells.forEach((slug, index) => {
        if (slug) {
          slots.set(slug, { row: firstRow + Math.floor(index / COLS), col: index % COLS })
        }
      })
    })
  }
  const cost = (): number =>
    edges.reduce((sum, edge) => {
      const a = slots.get(edge.from)
      const b = slots.get(edge.to)
      return a && b ? sum + Math.abs(a.col - b.col) + 2 * Math.abs(a.row - b.row) : sum
    }, 0)
  place()
  let best = cost()
  // Why: plain first-improvement hill climbing is deterministic and converges in a few passes here.
  for (let pass = 0; pass < 40; pass++) {
    let improved = false
    for (const cells of groupCells) {
      for (let i = 0; i < cells.length; i++) {
        for (let j = i + 1; j < cells.length; j++) {
          if (!cells[i] && !cells[j]) {
            continue
          }
          ;[cells[i], cells[j]] = [cells[j], cells[i]]
          place()
          const next = cost()
          if (next < best) {
            best = next
            improved = true
          } else {
            ;[cells[i], cells[j]] = [cells[j], cells[i]]
          }
        }
      }
    }
    place()
    if (!improved) {
      break
    }
  }
  return { slots, groupRows }
}

export function buildHqProjectMap(input: HqProjectMapInput): HqProjectMapDocument {
  const groups = orderedGroups(input)
  const edges = relationEdges(input.pages)
  const { slots, groupRows } = placeProjects(groups, edges)
  const slotOf = (slug: string): Slot => slots.get(slug) ?? { row: 0, col: 0 }
  const rowCount = groupRows.reduce((count, group) => count + group.rows.length, 0)
  const lastRows = new Set(groupRows.map((group) => group.rows.at(-1)))
  const firstRows = new Set(groupRows.slice(1).map((group) => group.rows[0]))

  // Lines run upper → lower (left → right within a row); undirected relations make that free.
  const routed = edges.map((edge) => {
    const a = slotOf(edge.from)
    const b = slotOf(edge.to)
    return a.row < b.row || (a.row === b.row && a.col <= b.col)
      ? edge
      : { from: edge.to, to: edge.from }
  })
  const rowLoad = new Map<number, number>()
  const colLoad = new Map<number, number>()
  const verticalCorridor = (a: Slot, b: Slot): number => (b.col > a.col ? b.col : a.col)
  for (const edge of routed) {
    const a = slotOf(edge.from)
    const b = slotOf(edge.to)
    rowLoad.set(a.row, (rowLoad.get(a.row) ?? 0) + 1)
    if (b.row > a.row + 1) {
      rowLoad.set(b.row - 1, (rowLoad.get(b.row - 1) ?? 0) + 1)
      const v = verticalCorridor(a, b)
      colLoad.set(v, (colLoad.get(v) ?? 0) + 1)
    }
  }
  const laneStart = (row: number): number => (lastRows.has(row) ? LANE_START_GROUP_END : LANE_START)
  const rowY: number[] = []
  let y = TOP
  for (let row = 0; row < rowCount; row++) {
    if (firstRows.has(row)) {
      y += GROUP_TITLE_SPACE
    }
    rowY.push(y)
    y += NODE_H + laneStart(row) + ((rowLoad.get(row) ?? 0) + 1) * LANE_STEP + LANE_START
  }
  const colX: number[] = []
  let x = 0
  for (let col = 0; col < COLS; col++) {
    x += Math.max(40, ((colLoad.get(col) ?? 0) + 1) * LANE_STEP + 16)
    colX.push(x)
    x += NODE_W
  }

  const taken = new Map<string, number>()
  const take = (key: string): number => {
    const next = (taken.get(key) ?? 0) + 1
    taken.set(key, next)
    return next
  }
  const corridorY = (row: number): number =>
    rowY[row] + NODE_H + laneStart(row) + take(`h${row}`) * LANE_STEP
  const centerX = (slot: Slot): number => colX[slot.col] + NODE_W / 2

  const connections = routed.map((edge): HqMapConnection => {
    const a = slotOf(edge.from)
    const b = slotOf(edge.to)
    const base = {
      id: `${componentId(edge.from)}--${componentId(edge.to)}`,
      from: componentId(edge.from),
      to: componentId(edge.to),
      fromSide: 'bottom' as const
    }
    if (b.row <= a.row + 1) {
      const lane = corridorY(a.row)
      return {
        ...base,
        toSide: a.row === b.row ? 'bottom' : 'top',
        via:
          centerX(a) === centerX(b)
            ? [[centerX(a), lane]]
            : [
                [centerX(a), lane],
                [centerX(b), lane]
              ]
      }
    }
    const upper = corridorY(a.row)
    const lower = corridorY(b.row - 1)
    const v = verticalCorridor(a, b)
    const laneX = colX[v] - 8 - take(`v${v}`) * LANE_STEP
    return {
      ...base,
      toSide: 'top',
      via: [
        [centerX(a), upper],
        [laneX, upper],
        [laneX, lower],
        [centerX(b), lower]
      ]
    }
  })

  const components = [...input.pages]
    .sort((a, b) => a.slug.localeCompare(b.slug))
    .map((page): HqMapComponent => {
      const slot = slotOf(page.slug)
      const summary = summaryOf(page)
      return {
        id: componentId(page.slug),
        type: componentType(page.status),
        label: page.slug,
        ...(summary ? { sublabel: summary } : {}),
        pos: [colX[slot.col], rowY[slot.row]],
        size: [NODE_W, NODE_H]
      }
    })

  return {
    schema_version: 1,
    diagram_type: 'architecture',
    meta: {
      title: 'All projects',
      subtitle:
        'Boxes are the projects in Orca, regions their groups, lines the relations their HQ pages name',
      output: 'projects.html',
      quality_profile: 'standard',
      legend: {
        mode: 'auto',
        entries: {
          backend: { label: 'Active' },
          external: { label: 'Quiet' },
          cloud: { label: 'Other status' }
        }
      }
    },
    components,
    boundaries: groups.map((group) => ({
      kind: 'region' as const,
      label: group.name,
      wraps: group.pages.map((page) => componentId(page.slug))
    })),
    connections
  }
}

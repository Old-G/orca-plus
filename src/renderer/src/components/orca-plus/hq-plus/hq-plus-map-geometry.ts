// Custom build (hq-plus-map): the map's geometry and colours — where the hub, the sources, the projects
// and the unfolded leaves stand, and how a project's strip of squares reads.
import type { HqPlusSource } from '../../../../../shared/hq-plus-kinds'
import type { HqPlusMapLeaf, HqPlusMapProject } from '../../../../../shared/hq-plus-map'

export const HQ_PLUS_SOURCE_COLOR: Record<HqPlusSource, string> = {
  slack: '#5fe0a0',
  clickup: '#b9a2ff',
  gmail: '#ff8a80',
  gitlab: '#fb923c'
}

export const HQ_PLUS_SOURCE_NAME: Record<HqPlusSource, string> = {
  slack: 'Slack',
  clickup: 'ClickUp',
  gmail: 'Gmail',
  gitlab: 'GitLab'
}

export const AMBER = '#ffc35a'
export const HUB_X = 78
export const X_SRC = 170
export const W_SRC = 150
export const H_SRC = 46
export const X_PRJ = 380
export const W_PRJ = 250
export const H_PRJ = 74
export const X_LEAF = 700
export const W_LEAF = 340
export const LEAF_H = 34
export const GAP = 14
export const TOP = 20
export const MIN_K = 0.3
export const MAX_K = 2.2

export function srcY(index: number): number {
  return 40 + index * 92
}

export function curve(x1: number, y1: number, x2: number, y2: number): string {
  const mid = (x1 + x2) / 2
  return `M${x1},${y1} C${mid},${y1} ${mid},${y2} ${x2},${y2}`
}

export function trunc(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

export function age(at: number, now: number): string {
  const days = Math.floor((now - at) / 86_400_000)
  return days <= 0 ? 'today' : `${days} d`
}

/** Each project's top and each unfolded leaf's top, and the map's height. */
export function placeRows(
  projects: readonly HqPlusMapProject[],
  expanded: ReadonlySet<string>
): { top: Map<string, number>; height: number } {
  const top = new Map<string, number>()
  let y = TOP
  for (const project of projects) {
    top.set(project.slug, y)
    const leaves = expanded.has(project.slug) ? project.leaves.length : 0
    y += Math.max(H_PRJ, leaves * LEAF_H + 4) + GAP
  }
  return { top, height: y }
}

export function leafHot(leaf: HqPlusMapLeaf): boolean {
  return (
    leaf.kind === 'talk' || (leaf.kind === 'person' ? leaf.answered > 0 : leaf.state === 'asks')
  )
}

/** The project's strip: what waits on the owner, then the waits, then the chats. */
export function squares(project: HqPlusMapProject): ('you' | 'wait' | 'chat')[] {
  const strip: ('you' | 'wait' | 'chat')[] = [
    ...Array<'you'>(Math.min(project.you, 14)).fill('you'),
    ...Array<'wait'>(project.waits).fill('wait'),
    ...Array<'chat'>(project.chats).fill('chat')
  ]
  return strip.slice(0, 18)
}

// Custom build (hq-waiting-replies): how HQ → Notes sorts the open waitings — answered first, then
// whom we wait on (by person, longest wait first), who waits on us, plain notes, and what is overdue.
import { HQ_NOTE_SOURCE } from '../../../../../shared/hq-note-parse'
import type { HqWaiting } from '../../../../../shared/hq-pulse-snapshot'

export type HqNotesFilter = 'waiting' | 'answered' | 'on-me' | 'overdue'

export type HqNotesBoard = {
  /** Whom we waited on has answered; newest answer first. */
  answered: HqWaiting[]
  waiting: HqWaiting[]
  onMe: HqWaiting[]
  notes: HqWaiting[]
  overdue: HqWaiting[]
}

export type HqNotesPersonGroup = { key: string; name: string | null; items: HqWaiting[] }

export function buildHqNotesBoard(waitings: readonly HqWaiting[], now: number): HqNotesBoard {
  const notes = waitings.filter((waiting) => waiting.source === HQ_NOTE_SOURCE)
  const others = waitings.filter((waiting) => waiting.source !== HQ_NOTE_SOURCE)
  const onThem = others.filter((waiting) => waiting.direction === 'on-them')
  return {
    answered: onThem
      .filter((waiting) => waiting.reply)
      .sort((a, b) => (b.reply?.at ?? 0) - (a.reply?.at ?? 0)),
    waiting: onThem.filter((waiting) => !waiting.reply),
    onMe: others.filter((waiting) => waiting.direction === 'on-me'),
    notes,
    overdue: waitings.filter((waiting) => waiting.dueAt !== null && waiting.dueAt < now)
  }
}

/** One group per person; the person kept waiting longest comes first. */
export function groupHqNotesByPerson(
  waitings: readonly HqWaiting[],
  personName: (personId: string) => string | null
): HqNotesPersonGroup[] {
  const groups = new Map<string, HqNotesPersonGroup>()
  for (const waiting of waitings) {
    const key = waiting.personId ?? ''
    const group = groups.get(key) ?? {
      key,
      name: waiting.personId ? personName(waiting.personId) : null,
      items: []
    }
    group.items.push(waiting)
    groups.set(key, group)
  }
  const oldest = (group: HqNotesPersonGroup): number =>
    Math.min(...group.items.map((waiting) => waiting.createdAt))
  return [...groups.values()]
    .map((group) => ({ ...group, items: group.items.sort((a, b) => a.createdAt - b.createdAt) }))
    .sort((a, b) => oldest(a) - oldest(b))
}

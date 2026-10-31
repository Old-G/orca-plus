// Custom build (hq-project-cards): «Today» on a project card — what the owner's approvals let out (a
// message, a delete, a push) and what chats said they merged or shipped, from today's journal rows.
import { HQ_JOURNAL_KIND, type HqJournalEntry } from './hq-journal'
import { hqPlusProjectOneLine as oneLine } from './hq-plus-project-lines'

export type HqPlusProjectTodayKind = 'sent' | 'deleted' | 'pushed' | 'merged' | 'shipped'

/** One thing done in the project today, by the chat that did it. A send, delete or push is the owner's
 *  approval of it, not proof that it ran; a merge or a release is the chat's own word. */
export type HqPlusProjectToday = {
  id: string
  at: number
  kind: HqPlusProjectTodayKind
  /** Where a message went (`#it-hub`, `DM Ann`) or what a delete touched (`GitLab · glab api delete`). */
  to: string | null
  /** The message, the command, or the chat's own line about the merge or the release. */
  text: string
  sessionId: string | null
}

/** «Approved → #it-hub: Slack · send message»: who it went to, then what the gate saw. */
const APPROVED = /^(?:Approved with edits|Approved)(?: → (.+))?: ([^:]*)$/s
/** выкачен(о/а/ы), выкатил(и/а), задеплоен(о/а), deployed, shipped. */
const SHIPPED =
  /(^|[^\p{L}])(выкачен[оаы]?|выкатил[иа]?|задеплоен[оа]?|deployed|shipped)(?![\p{L}])/giu
/** влит(о/а/ы), влил(и/а), merged. */
const MERGED = /(^|[^\p{L}])(влит[оаы]?|влил[иа]?|merged)(?![\p{L}])/giu
/** «не выкачено», «будет влито», «ready to be merged»: the word just before says it did not happen yet. */
const NEGATED = /(?:^|[^\p{L}])(?:не|будет|not|not yet|never|to be|will be|would be)\s+$/iu

function said(text: string, pattern: RegExp): boolean {
  for (const match of text.matchAll(pattern)) {
    const before = text.slice(0, (match.index ?? 0) + match[1].length)
    if (!NEGATED.test(before)) {
      return true
    }
  }
  return false
}

/** A journal row as a line of today's work, or null when it did nothing worth a line. */
export function hqPlusProjectToday(entry: HqJournalEntry): HqPlusProjectToday | null {
  const base = { id: entry.id, at: entry.at, sessionId: entry.sessionId }
  if (entry.kind === HQ_JOURNAL_KIND.approveResult) {
    const approved = APPROVED.exec(entry.title)
    if (!approved) {
      return null
    }
    const gate = approved[2].trim()
    const kind: HqPlusProjectTodayKind = /\bpush\b/i.test(gate)
      ? 'pushed'
      : /\bdelete\b/i.test(gate)
        ? 'deleted'
        : 'sent'
    return {
      ...base,
      kind,
      to: kind === 'sent' ? (approved[1]?.trim() ?? null) : gate,
      text: oneLine(entry.body ?? '') || gate
    }
  }
  if (entry.kind === HQ_JOURNAL_KIND.chatReport) {
    const text = oneLine(entry.title)
    if (said(text, SHIPPED)) {
      return { ...base, kind: 'shipped', to: null, text }
    }
    if (said(text, MERGED)) {
      return { ...base, kind: 'merged', to: null, text }
    }
  }
  return null
}

export const HQ_PLUS_PROJECT_TODAY_LABEL: Record<HqPlusProjectTodayKind, string> = {
  sent: 'Approved',
  deleted: 'Approved delete',
  pushed: 'Approved push',
  merged: 'Merged',
  shipped: 'Shipped'
}

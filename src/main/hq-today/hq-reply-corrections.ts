// Custom build (hq-reply-tone): the owner's edits to drafted replies — a ClickUp reply he changed
// before Send, a Slack message he changed in Approve — kept as tone lessons for the next drafts.
import { appendFile, mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { HqReplyCorrection } from '../../shared/hq-slack-request-prompts'
import { HQ_REPLY_CORRECTIONS_FILE, HQ_SLACK_SCOUT_DIR } from '../../shared/hq-slack-scout'
import type { PulseApprovalOutcome, PulseDraft } from '../../shared/pulse-types'

const EXAMPLE_CORRECTIONS = 5

export type HqReplyCorrectionEntry = HqReplyCorrection & {
  at: number
  source: 'clickup' | 'slack'
  /** The request or approval draft the reply belonged to. */
  id: string
}

function correctionsPath(hqPath: string): string {
  return join(hqPath, HQ_SLACK_SCOUT_DIR, HQ_REPLY_CORRECTIONS_FILE)
}

/** The owner's latest edits to drafts, newest last; a broken line is skipped. */
export async function readHqReplyCorrections(
  hqPath: string,
  limit = EXAMPLE_CORRECTIONS
): Promise<HqReplyCorrection[]> {
  const text = await readFile(correctionsPath(hqPath), 'utf8').catch(() => '')
  return text
    .split('\n')
    .flatMap((line): HqReplyCorrection[] => {
      try {
        const entry: unknown = JSON.parse(line)
        const draft = entry && typeof entry === 'object' ? Reflect.get(entry, 'draft') : null
        const sent = entry && typeof entry === 'object' ? Reflect.get(entry, 'sent') : null
        return typeof draft === 'string' && typeof sent === 'string' ? [{ draft, sent }] : []
      } catch {
        return []
      }
    })
    .slice(-limit)
}

/** Keeps a draft the owner changed; one he sent as is teaches nothing and is skipped. */
export async function appendHqReplyCorrection(
  hqPath: string,
  entry: HqReplyCorrectionEntry
): Promise<boolean> {
  const draft = entry.draft.trim()
  const sent = entry.sent.trim()
  if (!draft || !sent || draft === sent) {
    return false
  }
  await mkdir(join(hqPath, HQ_SLACK_SCOUT_DIR), { recursive: true })
  await appendFile(correctionsPath(hqPath), `${JSON.stringify({ ...entry, draft, sent })}\n`)
  return true
}

/** Keeps every Slack message the owner rewrites in Approve, while an HQ folder is set. */
export function keepHqApprovalEdits(
  hqPath: () => string | null,
  now: () => number = Date.now
): (decided: PulseDraft, outcome: PulseApprovalOutcome) => void {
  return (decided, outcome) => {
    const hq = hqPath()
    const correction = hq ? hqReplyCorrectionFromApproval(decided, outcome, now()) : null
    if (hq && correction) {
      void appendHqReplyCorrection(hq, correction).catch((error: unknown) =>
        console.warn('[hq-reply-corrections] keeping an Approve edit failed:', error)
      )
    }
  }
}

/** A Slack message the owner rewrote in Approve: the agent's text against what went out. */
export function hqReplyCorrectionFromApproval(
  decided: PulseDraft,
  outcome: PulseApprovalOutcome,
  at: number
): HqReplyCorrectionEntry | null {
  const call = decided.call
  const original = call?.editField ? call.toolInput[call.editField] : null
  if (outcome !== 'edited' || call?.service !== 'Slack' || typeof original !== 'string') {
    return null
  }
  return { at, source: 'slack', id: decided.id, draft: original, sent: decided.body }
}

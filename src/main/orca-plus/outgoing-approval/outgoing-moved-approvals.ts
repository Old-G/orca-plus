// Custom build (outgoing-venue): a message the owner moved to ClickUp or Slack was already approved
// there, so the agent's next call from the same chat that carries the same text to the chosen place —
// that task, or a DM — goes without a second card, once, and only for a few minutes.
import {
  carriesMovedText,
  type MovedTextAllowance
} from '../../../shared/outgoing-approval/outgoing-venue'
import type { PulseDraft } from '../../../shared/pulse-types'

// Why: the agent sends the moved text in its next step; a stale pass must not approve a later call.
const MOVE_WINDOW_MS = 10 * 60_000

type MovedApproval = {
  agentSessionId: string
  to: 'clickup' | 'slack'
  text: string
  until: number
  footer: boolean
  /** The task ids a moved comment may go to; a moved Slack message goes to a DM only. */
  taskIds: readonly string[]
  allowed: MovedTextAllowance
}

const SLACK_DM = /^[UD][A-Z0-9]{6,}$/

function reachesChosenPlace(entry: MovedApproval, draft: PulseDraft): boolean {
  const target = draft.target?.trim() ?? ''
  return entry.to === 'clickup' ? entry.taskIds.includes(target) : SLACK_DM.test(target)
}

function goesTo(draft: PulseDraft): 'clickup' | 'slack' | null {
  const call = draft.call
  if (!call) {
    return null
  }
  if (/clickup/i.test(call.service) && /\bcomment\b/.test(call.operation)) {
    return 'clickup'
  }
  return /slack/i.test(call.service) && /\b(send|reply|schedule)\b/.test(call.operation)
    ? 'slack'
    : null
}

export class MovedApprovals {
  private readonly moved: MovedApproval[] = []

  constructor(private readonly now: () => number = Date.now) {}

  add(entry: Omit<MovedApproval, 'until'>): void {
    this.moved.push({ ...entry, until: this.now() + MOVE_WINDOW_MS })
  }

  /** The approval this held call fulfils, used up; null when it is a new message. */
  take(draft: PulseDraft): { footer: boolean } | null {
    const now = this.now()
    for (let index = this.moved.length - 1; index >= 0; index -= 1) {
      if (this.moved[index].until < now) {
        this.moved.splice(index, 1)
      }
    }
    const to = goesTo(draft)
    const index = this.moved.findIndex(
      (entry) =>
        entry.agentSessionId === draft.call?.agentSessionId &&
        entry.to === to &&
        reachesChosenPlace(entry, draft) &&
        carriesMovedText(entry.text, draft.body, entry.allowed)
    )
    if (index === -1) {
      return null
    }
    const [entry] = this.moved.splice(index, 1)
    return { footer: entry.footer }
  }
}

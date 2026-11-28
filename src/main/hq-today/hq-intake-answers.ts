// Custom build (hq-intake-one-card, T7): which Slack messages are a person's answer to a waiting — the
// answer's own card (REPLY) stands for them, so they raise no second «To work».
import { hqIntakeKey } from '../../shared/hq-slack-intake'
import type { HqIntakeDraft } from './hq-slack-intake-suggest'

const ANSWER_SPAN_MS = 15 * 60_000

/** A Slack answer to a waiting: its card is the answer's, not a second «To work». `channel` is null
 *  when the question was recorded with no place; `ts` is the answer's own Slack ts. */
export type HqIntakeAnswer = {
  channel: string | null
  authorSlackId: string | null
  at: number
  ts?: string | null
  /** Router v2 T7: the waiting this answers, so a 👾 on the answer can pass it to its chat. */
  waitingId?: string
}

/** The answer that is this very Slack message, by its own ts (the channel too when the waiting
 *  names one). */
export function hqAnswerOfMessage(
  draft: HqIntakeDraft,
  answers: readonly HqIntakeAnswer[]
): HqIntakeAnswer | null {
  return (
    answers.find(
      (answer) =>
        !!answer.ts &&
        answer.ts === draft.ts &&
        (!answer.channel || answer.channel === draft.channel)
    ) ?? null
  )
}

function isAnswerMessage(draft: HqIntakeDraft, answers: readonly HqIntakeAnswer[]): boolean {
  return hqAnswerOfMessage(draft, answers) !== null
}

export function answersWaiting(
  draft: HqIntakeDraft,
  answers: readonly HqIntakeAnswer[],
  { loose }: { loose: boolean } = { loose: true }
): boolean {
  if (isAnswerMessage(draft, answers)) {
    return true
  }
  // Why: a 👾 is a deliberate ask, so it yields to an answer only when it is that very message.
  return (
    loose &&
    answers.some(
      (answer) =>
        answer.channel === draft.channel &&
        (answer.authorSlackId === null || answer.authorSlackId === draft.authorSlackId) &&
        draft.at >= answer.at - ANSWER_SPAN_MS &&
        draft.at <= answer.at + 2 * 60_000
    )
  )
}

/** Router v2 T7: the owner's 👾 on the answer itself is his «pass it on» — before, the mark gave way
 *  to the answer card and nothing went until he clicked it (28.11: a colleague's file sat there). */
export async function hqPassMarkedAnswers(
  deps: {
    passAnswer?: (waitingId: string, replyTs: string) => Promise<boolean>
    noteMark?: (key: string, outcome: string) => void
    now: () => number
  },
  drafts: readonly HqIntakeDraft[],
  answers: readonly HqIntakeAnswer[],
  windowMs: number
): Promise<void> {
  for (const draft of drafts) {
    const answer = hqAnswerOfMessage(draft, answers)
    if (!answer?.waitingId || !deps.passAnswer || deps.now() - draft.at > windowMs) {
      continue
    }
    const passed = await deps.passAnswer(answer.waitingId, draft.ts).catch(() => false)
    deps.noteMark?.(
      hqIntakeKey(draft),
      passed
        ? 'answer passed to the waiting chat'
        : 'answer not passed (passed before or chat closed)'
    )
  }
}

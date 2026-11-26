// Custom build (hq-intake-one-card, T7): which Slack messages are a person's answer to a waiting — the
// answer's own card (REPLY) stands for them, so they raise no second «To work».
import type { HqIntakeDraft } from './hq-slack-intake-suggest'

const ANSWER_SPAN_MS = 15 * 60_000

/** A Slack answer to a waiting: its card is the answer's, not a second «To work». `channel` is null
 *  when the question was recorded with no place; `ts` is the answer's own Slack ts. */
export type HqIntakeAnswer = {
  channel: string | null
  authorSlackId: string | null
  at: number
  ts?: string | null
}

/** The same Slack message, by its own ts (the channel too when the waiting names one). */
function isAnswerMessage(draft: HqIntakeDraft, answers: readonly HqIntakeAnswer[]): boolean {
  return answers.some(
    (answer) =>
      !!answer.ts && answer.ts === draft.ts && (!answer.channel || answer.channel === draft.channel)
  )
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

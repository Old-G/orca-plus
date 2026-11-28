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
 *  to the answer card and nothing went until he clicked it (28.11: a colleague's file sat there).
 *  Returns the ts of marked answers whose chat could not take them (closed): they are routed like
 *  any 👾 instead of waiting on the card. */
export async function hqPassMarkedAnswers(
  deps: {
    passAnswer?: (waitingId: string, replyTs: string) => Promise<HqAnswerPass>
    noteMark?: (key: string, outcome: string) => void
    now: () => number
  },
  drafts: readonly HqIntakeDraft[],
  answers: readonly HqIntakeAnswer[],
  windowMs: number
): Promise<Set<string>> {
  const toRoute = new Set<string>()
  for (const draft of drafts) {
    const answer = hqAnswerOfMessage(draft, answers)
    if (!answer?.waitingId || !deps.passAnswer || deps.now() - draft.at > windowMs) {
      continue
    }
    // Why: 🆕 asks for a new chat, whatever the message answers.
    if (draft.newMark) {
      toRoute.add(draft.ts)
      continue
    }
    const pass = await deps.passAnswer(answer.waitingId, draft.ts).catch(() => 'failed' as const)
    if (pass === 'chat-closed' || pass === 'no-chat') {
      toRoute.add(draft.ts)
    }
    deps.noteMark?.(hqIntakeKey(draft), HQ_ANSWER_PASS_NOTE[pass])
  }
  return toRoute
}

export type HqAnswerPass = 'passed' | 'gone' | 'chat-closed' | 'no-chat' | 'failed'

const HQ_ANSWER_PASS_NOTE: Record<HqAnswerPass, string> = {
  passed: 'answer passed to the waiting chat',
  gone: 'answer passed before',
  'chat-closed': 'answer: the waiting chat is closed, routed instead',
  'no-chat': 'answer: the waiting has no chat, routed instead',
  failed: 'answer not passed (error)'
}

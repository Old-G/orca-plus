// Custom build (hq-router T4, owner 26.11): what «Send» on a To work / Router card leaves behind — the
// thread stays with the chosen chat (the conversation and the router's binding) and the router's log
// gets the owner's choice. Pasted text has no Slack thread; its choice is only logged.
import { hqIntakeHasNoSlackMessage, type HqIntake } from '../../shared/hq-slack-intake'
import { hqRouterIgnorePrompt } from '../../shared/hq-router-send-first'

export type HqIntakeCloseRouteDeps = {
  setConversationChat: (key: string, chat: string) => void
  bindChoice: (input: { channel: string; threadTs: string; chat: string; at: number }) => void
  logChoice: (key: string, chat: string, at: number) => void
  now: number
}

/** The router log's key for a card: the marked message. */
export function hqRouterLogKey(message: { channel: string; ts: string }): string {
  return `slack:${message.channel}:${message.ts}`
}

export function hqIntakeCloseRoute(
  intake: HqIntake,
  chat: string,
  deps: HqIntakeCloseRouteDeps
): void {
  const threadTs = intake.threadTs ?? intake.ts
  if (!hqIntakeHasNoSlackMessage(intake)) {
    deps.setConversationChat(`slack:${intake.channel}:${threadTs}`, chat)
    deps.bindChoice({ channel: intake.channel, threadTs, chat, at: deps.now })
  }
  deps.logChoice(hqRouterLogKey(intake), chat, deps.now)
}

/**
 * Router v2 T5: the owner closed a card the router had sent by itself. «OK» (the same chat) is his word
 * that it went right; another chat is «Wrong chat» — the chat that had it is told to ignore it. Either
 * way the auto row's outcome becomes his choice, which the T4 gate counts. Null for a card not sent so.
 */
export async function hqIntakeSentClose(
  intake: HqIntake,
  chat: string,
  deps: {
    deliver: (chat: string, prompt: string) => Promise<boolean>
    rewriteOutcome: (
      key: string,
      input: { chosen: string; at: number; reason: string; by: 'owner' }
    ) => void
    now: number
  }
): Promise<'ok' | 'wrong' | null> {
  const sent = intake.sent
  if (!sent) {
    return null
  }
  const wrong = sent.chat !== chat
  deps.rewriteOutcome(hqRouterLogKey(intake), {
    chosen: chat,
    at: deps.now,
    reason: wrong ? 'wrong-chat' : 'ok',
    by: 'owner'
  })
  if (wrong) {
    await deps.deliver(sent.chat, hqRouterIgnorePrompt(intake, sent.at)).catch(() => false)
  }
  return wrong ? 'wrong' : 'ok'
}

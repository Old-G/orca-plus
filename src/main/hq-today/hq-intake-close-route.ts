// Custom build (hq-router T4, owner 26.11): what «Send» on a To work / Router card leaves behind — the
// thread stays with the chosen chat (the conversation and the router's binding) and the router's log
// gets the owner's choice. Pasted text has no Slack thread; its choice is only logged.
import { hqIntakeIsPastedText, type HqIntake } from '../../shared/hq-slack-intake'

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
  if (!hqIntakeIsPastedText(intake)) {
    deps.setConversationChat(`slack:${intake.channel}:${threadTs}`, chat)
    deps.bindChoice({ channel: intake.channel, threadTs, chat, at: deps.now })
  }
  deps.logChoice(hqRouterLogKey(intake), chat, deps.now)
}

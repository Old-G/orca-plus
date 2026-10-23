// Custom build (hq-slack-intake, hq-reply-approve): hands a prompt to the chosen chat — an open chat
// through its composer (a closed one is brought back first), or a new chat of the chosen project.
import { toast } from 'sonner'
import { structuredAgentSessionTabId } from '../../../../../shared/structured-agent-session-projection'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import type { HqRouteChat } from './hq-route-targets'

// Why: a reopened chat takes a moment to attach its session before it can take a turn.
const REOPEN_TRIES = 15
const REOPEN_STEP_MS = 1_000

export type HqRouteTarget =
  | { kind: 'chat'; chat: Pick<HqRouteChat, 'sessionId' | 'worktreeId' | 'title'> }
  | { kind: 'new'; worktreeId: string; name: string }

export type HqSendResult = { ok: true } | { ok: false; reason: 'gone' | 'no-chat' | 'chat-closed' }

// Why lazy: reopening a chat pulls in the session-restore stack, needed only on a click.
export async function openHqRouteChat(chat: {
  worktreeId: string
  sessionId: string
}): Promise<void> {
  const { openHqHistoryEntry } = await import('../hq/hq-history-open')
  await openHqHistoryEntry({ ...chat, tabId: structuredAgentSessionTabId(chat.sessionId) })
}

function isHqRouteChatListed(chat: { worktreeId: string; sessionId: string }): boolean {
  const tabId = structuredAgentSessionTabId(chat.sessionId)
  return Boolean(
    useAppStore.getState().unifiedTabsByWorktree[chat.worktreeId]?.some((tab) => tab.id === tabId)
  )
}

/** Runs `send`; a closed chat is reopened and `send` tried again until it takes the turn. */
export async function sendWithReopen(
  chat: { worktreeId: string; sessionId: string } | null,
  send: () => Promise<HqSendResult>
): Promise<HqSendResult> {
  let result = await send()
  if (!result.ok && result.reason === 'chat-closed' && chat) {
    await openHqRouteChat(chat)
    for (let tries = 0; tries < REOPEN_TRIES && !result.ok; tries += 1) {
      await new Promise((resolve) => setTimeout(resolve, REOPEN_STEP_MS))
      result = await send()
      if (!result.ok && result.reason !== 'chat-closed') {
        break
      }
    }
  }
  return result
}

/** True once the prompt reached the chat; says so either way. */
export async function sendHqRoutePrompt(target: HqRouteTarget, prompt: string): Promise<boolean> {
  if (target.kind === 'new') {
    const { startHqChatWithPrompt } = await import('../hq/hq-ask-chat')
    const started = await startHqChatWithPrompt(target.worktreeId, prompt, target.name)
    if (!started.ok) {
      toast.error(started.message)
      return false
    }
    toast.success(
      translate('auto.hqRoute.started', 'Started a new chat: {{name}}', { name: target.name })
    )
    return true
  }
  const result = await sendWithReopen(target.chat, () =>
    window.api.pulseBell.sendToChat(target.chat.sessionId, prompt)
  )
  if (result.ok) {
    // Why: a closed chat with a live session takes the turn unseen; it must come back to the sidebar.
    if (!isHqRouteChatListed(target.chat)) {
      await openHqRouteChat(target.chat).catch(() => undefined)
    }
    toast.success(translate('auto.hqRoute.sent', 'Sent to «{{name}}»', { name: target.chat.title }))
    return true
  }
  toast.error(
    translate('auto.hqRoute.notTaken', 'The chat could not take it — open the chat and send again')
  )
  return false
}

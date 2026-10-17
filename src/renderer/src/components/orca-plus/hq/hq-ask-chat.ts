// Custom build (hq-ask): «Ask HQ» — one standing chat in the HQ workspace for questions about
// everything; the first question starts it, later ones go to the same chat, and HQ stays in front.
import {
  hqReportChatName,
  hqReportDecisionsPrompt,
  type HqReport
} from '../../../../../shared/hq-reports'
import { translate } from '@/i18n/i18n'
import { newAgentLaunchRequestId } from '@/lib/agent-launch-request-id'
import { launchAgentInNewTab } from '@/lib/launch-agent-in-new-tab'
import {
  deriveRunningAgentSendTargets,
  deriveStatuslessStructuredAgentSendTargets,
  type StructuredAgentSendTarget
} from '@/lib/running-agent-targets'
import { useAppStore } from '@/store'
import { hqChatKey } from './hq-chat-list'
import { openChatInShownHq, openHqChat } from './hq-chat-open'
import {
  agentPaneKeys,
  sendHqAgentMessage,
  waitForNewAgentPane,
  type HqActionResult
} from './hq-today-actions'

/** Names the ask-hq skill once, so the chat keeps answering that way without a prefix. */
export function hqAskFirstPrompt(question: string): string {
  return `Спроси HQ (скилл ask-hq): ${question.trim()}`
}

/** In HQ's chat pane: the messenger in front, or HQ opened on its chats. */
function showHqAskChat(worktreeId: string, tabId: string): void {
  if (!openChatInShownHq(worktreeId, tabId)) {
    openHqChat(hqChatKey(worktreeId, tabId))
  }
}

function structuredTargets(worktreeId: string): StructuredAgentSendTarget[] {
  const state = useAppStore.getState()
  return [
    ...deriveRunningAgentSendTargets(state, worktreeId),
    ...deriveStatuslessStructuredAgentSendTargets(state, worktreeId)
  ].filter((target): target is StructuredAgentSendTarget => target.kind === 'structured-session')
}

/** The standing chat, while it is still open in the HQ workspace. */
export function findHqAskChat(
  worktreeId: string,
  sessionId: string | null | undefined
): StructuredAgentSendTarget | null {
  if (!sessionId) {
    return null
  }
  return structuredTargets(worktreeId).find((target) => target.sessionId === sessionId) ?? null
}

/** A new chat in the HQ workspace with the prompt and a short name, shown in HQ once its tab appears. */
async function startHqChatWithPrompt(
  worktreeId: string,
  prompt: string,
  name: string
): Promise<{ ok: true; chat: StructuredAgentSendTarget | null } | { ok: false; message: string }> {
  const before = agentPaneKeys(worktreeId)
  const launched = launchAgentInNewTab({
    requestId: newAgentLaunchRequestId(),
    agent: 'claude',
    worktreeId,
    prompt,
    promptDelivery: 'submit-after-ready',
    launchSource: 'unknown'
  })
  if (!launched) {
    return {
      ok: false,
      message: translate('auto.hq.today.launchFailed', "Couldn't start Claude in HQ.")
    }
  }
  const paneKey = await waitForNewAgentPane(worktreeId, before)
  const chat = structuredTargets(worktreeId).find((target) => target.paneKey === paneKey) ?? null
  if (chat) {
    // Why: otherwise the chat is named after its first prompt, skill prefix included.
    useAppStore.getState().setTabCustomLabel(chat.tabId, name, { recordInteraction: false })
    showHqAskChat(worktreeId, chat.tabId)
  }
  return { ok: true, chat }
}

async function startHqAskChat(worktreeId: string, question: string): Promise<HqActionResult> {
  const started = await startHqChatWithPrompt(
    worktreeId,
    hqAskFirstPrompt(question),
    translate('auto.hq.ask.chatName', 'Ask HQ')
  )
  if (started.ok && started.chat) {
    void useAppStore.getState().updateSettings({ hqAskSessionId: started.chat.sessionId })
  }
  return started.ok ? { ok: true } : started
}

// Custom build (hq-status-update): the owner presses the button; nothing drafts a status on its own.
export const HQ_STATUS_UPDATE_PROMPT =
  'Статус Жене (скилл status-update): собери статус по всем проектам с прошлого отправленного, покажи черновик и жди моего «да».'

/** A fresh HQ chat that drafts the status update and waits for the owner's yes. */
export async function startHqStatusUpdate(worktreeId: string): Promise<HqActionResult> {
  const started = await startHqChatWithPrompt(
    worktreeId,
    HQ_STATUS_UPDATE_PROMPT,
    translate('auto.hq.status.chatName', 'Status update')
  )
  return started.ok ? { ok: true } : started
}

/** Custom build (hq-reports): a fresh HQ chat that carries out the owner's decisions on a report. */
export async function startHqReportDecisions(
  worktreeId: string,
  report: Pick<HqReport, 'path' | 'folder'>,
  text: string
): Promise<HqActionResult> {
  const started = await startHqChatWithPrompt(
    worktreeId,
    hqReportDecisionsPrompt(report, text),
    hqReportChatName(report.path)
  )
  return started.ok ? { ok: true } : started
}

/** Sends the question to the standing chat, or starts it when it is gone. */
export async function askHq(worktreeId: string, question: string): Promise<HqActionResult> {
  const sessionId = useAppStore.getState().settings?.hqAskSessionId
  const chat = findHqAskChat(worktreeId, sessionId)
  if (!chat) {
    return startHqAskChat(worktreeId, question)
  }
  const sent = await sendHqAgentMessage({ paneKey: chat.paneKey, worktreeId }, question.trim())
  if (sent.ok) {
    showHqAskChat(worktreeId, chat.tabId)
  }
  return sent
}

// Custom build (chat-continue-new, T6 of plan 2026-11-14-lead-models-limits): «Continue in new chat»
// for a long Claude chat left idle. The prompt comes from the chat's saved record, as the upstream
// «Hand Off to Another Agent» builds it, so the old chat is never woken (that wake is the re-read this
// saves); main starts the new chat on the old one's model, effort, role and thread.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import { withTimeout } from '../../../../../../shared/concurrency/promise-timeout-fallback'
import { buildAgentSessionContinuationPrompt } from '../../../../../../shared/agent-session/conversation-context/agent-session-continuation'
import { callStructuredAgentSession } from '@/runtime/native-chat/requests/structured-agent-session-call'
import { supportsStructuredAgentSessionContinuationContext } from '@/runtime/native-chat/host-capabilities/structured-agent-session-host-support'
import { buildAgentSessionHandoffContext } from '../../../../../../shared/native-chat/transcript/agent-session-handoff-context'
import type { AgentSessionContinuationContext } from '../../../../../../shared/agent-session/agent-session-wire'
import type { NativeChatMessage } from '../../../../../../shared/native-chat/native-chat-types'
import { structuredAgentSessionTabId } from '../../../../../../shared/agent-session/view/structured-agent-session-projection'
import {
  lastNativeChatActivityAt,
  nativeChatContinueNewDue,
  nativeChatContinueNewDueAt
} from '../../../../../../shared/native-chat/native-chat-continue-new'
import { activateAndRevealWorktree } from '@/lib/workspace/activation/worktree-activation'
import { openChatInShownHq } from '@/components/orca-plus/hq/hq-chat-open'
import type { NativeChatStructuredViewProps } from '../../native-chat-view-types'
import type { NativeChatFileLinkContext } from '../../links/actions/native-chat-file-link-context'
import type { NativeChatContinueNew } from '../../usage/native-chat-continue-new-context'

export function useNativeChatContinueNew({
  pane,
  directory,
  messages,
  epoch,
  usedTokens,
  isWorking,
  available
}: {
  pane: Pick<NativeChatStructuredViewProps, 'sessionId' | 'target' | 'agent'>
  directory: NativeChatFileLinkContext | null
  messages: readonly NativeChatMessage[]
  epoch: string | null
  usedTokens: number | null
  isWorking: boolean
  /** The upstream hand-off can seed a chat here (same host, saved epoch). */
  available: boolean
}): NativeChatContinueNew | null {
  const lastActivityAt = useMemo(() => lastNativeChatActivityAt(messages), [messages])
  const [now, setNow] = useState(() => Date.now())
  const [starting, setStarting] = useState(false)
  const facts = { usedTokens, lastActivityAt, isWorking }
  const dueAt = nativeChatContinueNewDueAt(facts)
  const pastDue = dueAt !== null && now >= dueAt
  useEffect(() => {
    setNow(Date.now())
    if (dueAt === null) {
      return
    }
    // Why: a chat opened at 50 minutes idle turns due while it stays on screen, and the card's idle
    // time keeps up after that; once a minute is enough for both.
    const tick = (): void => setNow(Date.now())
    const wait = dueAt - Date.now()
    if (wait > 0) {
      const timer = window.setTimeout(tick, Math.min(wait, 2 ** 31 - 1))
      return () => window.clearTimeout(timer)
    }
    const timer = window.setInterval(tick, 60_000)
    return () => window.clearInterval(timer)
  }, [dueAt, pastDue])
  const due = pane.agent === 'claude' && available && nativeChatContinueNewDue({ ...facts, now })
  // Why: the prompt takes up to 30 s to build; a message sent meanwhile must not be cut off by the close.
  const workingRef = useRef(isWorking)
  useEffect(() => {
    workingRef.current = isWorking
  }, [isWorking])

  const start = useCallback(
    async (message?: string): Promise<boolean> => {
      if (starting || !directory || !epoch) {
        return false
      }
      setStarting(true)
      try {
        const context = await withTimeout(
          (async () =>
            (await supportsStructuredAgentSessionContinuationContext(pane.target))
              ? callStructuredAgentSession<AgentSessionContinuationContext>(
                  pane.target,
                  'agentSession.continuationContext',
                  {
                    sessionId: pane.sessionId,
                    workspaceId: directory.worktreeId,
                    expectedCursor: { epoch, sequence: 0 }
                  }
                )
              : null)(),
          30_000,
          null
        )
        if (context?.status === 'superseded' || workingRef.current) {
          toast.info(
            translate(
              'components.native-chat.continueNew.moved',
              'The chat moved on; it stays where it is.'
            )
          )
          return false
        }
        const saved = context?.status === 'current' && typeof context.capturedText === 'string'
        const prompt = buildAgentSessionContinuationPrompt(
          {
            sourceKind: 'chat',
            sourceAgent: 'claude',
            sourceWorkingDirectory: directory.worktreePath,
            transcriptPath: saved ? context.transcriptPath : undefined,
            capturedText: saved
              ? (context.capturedText ?? '')
              : buildAgentSessionHandoffContext(messages)
          },
          'focused'
        )
        if (!prompt) {
          toast.error(
            translate(
              'components.agentSessionContinuation.noContext',
              'No session context is available to continue in a new session.'
            )
          )
          return false
        }
        if (workingRef.current) {
          return false
        }
        const result = await window.api.claudeHandoff.continueChat(
          directory.worktreeId,
          structuredAgentSessionTabId(pane.sessionId),
          message?.trim()
            ? `${prompt}\n\nMy new message, sent after the context above:\n\n${message}`
            : prompt
        )
        if (!result.ok) {
          toast.error(
            translate('auto.claudeHandoff.offer.launchFailed', 'Could not start the new session'),
            { description: result.error }
          )
          return false
        }
        if (!openChatInShownHq(result.worktreeId, result.tabId)) {
          activateAndRevealWorktree(result.worktreeId)
        }
        return true
      } finally {
        setStarting(false)
      }
    },
    [starting, directory, epoch, pane.target, pane.sessionId, messages]
  )

  return due && usedTokens !== null && lastActivityAt !== null
    ? { usedTokens, idleMs: now - lastActivityAt, starting, start }
    : null
}

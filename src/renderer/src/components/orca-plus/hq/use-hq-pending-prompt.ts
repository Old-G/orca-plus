// Custom build (hq-chats): the question or approval a native chat waits on, read through the same
// shared reader its chat view uses, and the answer sent the way the chat's own card sends it — so
// HQ's list can say what is asked and answer a simple question in place. An approval is never
// granted from the list: its row says what is asked and leads to the chat's full card.
import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react'
import type { AgentSessionPromptResponse } from '../../../../../shared/agent-session-question-answer'
import { agentSessionPromptQuestions } from '../../../../../shared/agent-session-question-answer'
import type { RuntimeClientTarget } from '../../../../../shared/runtime-client-target'
import {
  structuredAgentSessionOwnerForTab,
  structuredAgentSessionTargetForHost
} from '@/runtime/structured-agent-session-owner'
import { useAppStore } from '@/store'
import { getStructuredAgentSessionReadOwner } from '../../native-chat/structured-agent-session-read-owner'
import {
  pendingStructuredSessionPrompts,
  type StructuredPromptItem
} from '../../native-chat/structured-agent-session-message-projection'
import { respondToStructuredAgentSessionPrompt } from '../../native-chat/structured-agent-session-prompt-response'
import { useStructuredAgentSessionMutate } from '../../native-chat/use-structured-agent-session-mutate'
import type { HqChatItem } from './hq-chat-list'

/** One click that answers the prompt: an approval's decision, or an option of a lone
 *  single-choice question. */
export type HqQuickAnswer = { id: string; label: string; response: AgentSessionPromptResponse }

export type HqPendingPrompt = {
  kind: 'approval' | 'question'
  /** What the agent asks, in one line. */
  text: string
  /** For an approval, what it would run or touch, as the host words it. */
  detail: string | null
  /** Empty when the prompt needs the full card: every approval (what it allows, and for how long,
   *  is read there), several questions, multi-select, no options. */
  answers: HqQuickAnswer[]
}

const NO_TARGET: RuntimeClientTarget = { kind: 'local' }
const noSubscription = (): (() => void) => () => {}
const NO_SNAPSHOT = null

export function describeHqPendingPrompt(prompt: StructuredPromptItem): HqPendingPrompt {
  const body = prompt.body
  if (body.kind === 'approval') {
    return {
      kind: 'approval',
      text: body.displayName ?? body.title,
      detail: body.detail ?? body.description ?? null,
      answers: []
    }
  }
  const questions = agentSessionPromptQuestions(body)
  const [only] = questions
  // Why: a free-text field beside the options does not stop a click on an offered option.
  const simple = questions.length === 1 && !only.multiSelect && only.options.length > 0
  return {
    kind: 'question',
    text: only?.question ?? body.question,
    detail: null,
    answers: simple
      ? only.options.map((option) => ({
          id: option.id,
          label: option.label,
          response: { kind: 'answers', answers: [{ questionId: only.id, optionIds: [option.id] }] }
        }))
      : []
  }
}

/** Reads only while `item` is a native chat that needs the user and its host is reachable. */
export function useHqPendingPrompt(item: HqChatItem): {
  prompt: HqPendingPrompt | null
  respond: (response: AgentSessionPromptResponse) => Promise<boolean>
} {
  const tab = item.kind === 'chat' && item.group === 'needs' ? item.tab : null
  const owner = useAppStore((state) => (tab ? structuredAgentSessionOwnerForTab(state, tab) : null))
  const target = useMemo(() => structuredAgentSessionTargetForHost(owner), [owner])
  const sessionId = tab?.entityId ?? null
  // Why: keyed on the session, not the tab object — a rebuilt list must not restart the read.
  const reader = useMemo(
    () => (sessionId && target ? getStructuredAgentSessionReadOwner(sessionId, target) : null),
    [sessionId, target]
  )
  useEffect(() => reader?.activate(), [reader])
  const snapshot = useSyncExternalStore(
    reader?.subscribe ?? noSubscription,
    () => reader?.getSnapshot() ?? NO_SNAPSHOT,
    () => NO_SNAPSHOT
  )
  const pending = useMemo(
    () =>
      snapshot
        ? (pendingStructuredSessionPrompts({
            journalItems: snapshot.state.items,
            ...(snapshot.state.actionablePromptIds
              ? { actionablePromptIds: snapshot.state.actionablePromptIds }
              : {})
          })[0] ?? null)
        : null,
    [snapshot]
  )
  const stateRef = useRef({ fence: snapshot?.state.fence ?? null })
  useEffect(() => {
    stateRef.current = { fence: snapshot?.state.fence ?? null }
  }, [snapshot])
  const { mutate } = useStructuredAgentSessionMutate({
    sessionId: sessionId ?? '',
    target: target ?? NO_TARGET,
    enabled: Boolean(reader),
    stateRef
  })
  const respond = useCallback(
    async (response: AgentSessionPromptResponse): Promise<boolean> => {
      if (!pending || !target) {
        return false
      }
      const result = await respondToStructuredAgentSessionPrompt({
        item: pending,
        response,
        target,
        mutate
      })
      return result !== null
    },
    [mutate, pending, target]
  )
  const prompt = useMemo(() => (pending ? describeHqPendingPrompt(pending) : null), [pending])
  return { prompt, respond }
}

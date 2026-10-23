// Custom build (hq-plus-ui-v5): a chat card opened in HQ+ shows the agent's whole latest reply, read
// from the chat's own transcript (what its pane shows), not the journal's summary.
import { useEffect, useState } from 'react'
import type { AgentSessionHistoryResult } from '../../../../../shared/agent-session-wire'
import { callStructuredAgentSession } from '@/runtime/structured-agent-session-client'

const TAIL_ITEMS = 40

/** The text of the newest assistant message among transcript items; null when there is none. */
export function hqPlusLastAssistantText(items: readonly unknown[]): string | null {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const body: unknown = Reflect.get(Object(items[index]), 'body')
    if (
      !body ||
      typeof body !== 'object' ||
      Reflect.get(body, 'kind') !== 'message' ||
      Reflect.get(body, 'role') !== 'assistant'
    ) {
      continue
    }
    const blocks: unknown = Reflect.get(body, 'blocks')
    const text = (Array.isArray(blocks) ? blocks : [])
      .flatMap((block: unknown) =>
        block &&
        typeof block === 'object' &&
        Reflect.get(block, 'type') === 'text' &&
        typeof Reflect.get(block, 'text') === 'string'
          ? [String(Reflect.get(block, 'text'))]
          : []
      )
      .join('\n\n')
      .trim()
    if (text) {
      return text
    }
  }
  return null
}

/** While `open`, the chat's latest reply; null until read or when the transcript is out of reach. */
export function useHqPlusLastReply(
  sessionId: string | null,
  open: boolean,
  at: number
): string | null {
  const [reply, setReply] = useState<{ key: string; text: string | null } | null>(null)
  const key = `${sessionId ?? ''}|${at}`
  useEffect(() => {
    if (!open || !sessionId) {
      return
    }
    let live = true
    void callStructuredAgentSession<AgentSessionHistoryResult>(
      { kind: 'local' },
      'agentSession.history',
      {
        sessionId,
        direction: 'tail',
        limit: TAIL_ITEMS
      }
    )
      .then((result) => {
        if (live) {
          setReply({ key, text: hqPlusLastAssistantText(result.page.items) })
        }
      })
      .catch(() => {
        if (live) {
          setReply({ key, text: null })
        }
      })
    return () => {
      live = false
    }
  }, [open, sessionId, key])
  return reply?.key === key ? reply.text : null
}

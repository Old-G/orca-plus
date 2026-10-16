// Custom build (hq-history): HQ's History list — the bell's agent-finished log of the last week, reloaded
// as the bell changes and once a minute.
import { useEffect, useState } from 'react'
import {
  buildHqChatHistory,
  HQ_HISTORY_WINDOW_MS,
  readHqHistorySource,
  type HqHistoryEntry
} from '../../../../../shared/hq-chat-history'
import { PULSE_BELL_KIND } from '../../../../../shared/pulse-bell'

export type HqChatHistoryState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; entries: HqHistoryEntry[] }

const REFRESH_MS = 60_000

async function loadHistory(): Promise<HqHistoryEntry[]> {
  const now = Date.now()
  const response = await window.api.runtime.call({
    method: 'pulse.listInbox',
    params: {
      includeDone: true,
      kind: PULSE_BELL_KIND.agentFinished,
      since: now - HQ_HISTORY_WINDOW_MS
    }
  })
  if (!response.ok) {
    throw new Error(response.error.message)
  }
  return buildHqChatHistory(readHqHistorySource(response.result), now)
}

export function useHqChatHistory(): HqChatHistoryState {
  const [state, setState] = useState<HqChatHistoryState>({ status: 'loading' })
  useEffect(() => {
    let alive = true
    const load = (): void => {
      loadHistory()
        .then((entries) => {
          if (alive) {
            setState({ status: 'ready', entries })
          }
        })
        .catch((error: unknown) => {
          if (alive) {
            setState({ status: 'error', message: String(error) })
          }
        })
    }
    load()
    const unsubscribe = window.api.pulseBell.onChanged(load)
    const timer = setInterval(load, REFRESH_MS)
    return () => {
      alive = false
      unsubscribe()
      clearInterval(timer)
    }
  }, [])
  return state
}

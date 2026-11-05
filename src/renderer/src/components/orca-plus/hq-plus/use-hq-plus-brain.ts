// Custom build (hq-plus-brain): what the «Brain» screen shows for one query — the host runs HQ's brain
// script (`hq.brain`); a newer query wins over a slower older one.
import { useEffect, useState } from 'react'
import { isHqBrainResult, type HqBrainResult } from '../../../../../shared/hq-brain'

export type HqPlusBrainState =
  | { status: 'idle' }
  | { status: 'loading'; query: string }
  | { status: 'ready'; query: string; result: HqBrainResult }
  | { status: 'error'; query: string; message: string }

export function useHqPlusBrain(query: string): HqPlusBrainState {
  const [state, setState] = useState<HqPlusBrainState>({ status: 'idle' })
  useEffect(() => {
    const text = query.trim()
    if (!text) {
      setState({ status: 'idle' })
      return
    }
    let alive = true
    setState({ status: 'loading', query: text })
    window.api.runtime
      .call({ method: 'hq.brain', params: { query: text } })
      .then((response) => {
        if (!alive) {
          return
        }
        if (!response.ok) {
          setState({ status: 'error', query: text, message: response.error.message })
        } else if (isHqBrainResult(response.result)) {
          setState({ status: 'ready', query: text, result: response.result })
        } else {
          setState({
            status: 'error',
            query: text,
            message: 'The brain answered in an unknown shape.'
          })
        }
      })
      .catch((error: unknown) => {
        if (alive) {
          setState({
            status: 'error',
            query: text,
            message: error instanceof Error ? error.message : String(error)
          })
        }
      })
    return () => {
      alive = false
    }
  }, [query])
  return state
}

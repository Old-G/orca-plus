// Custom build (hq): the pulse records behind HQ, refreshed whenever main reports a pulse write,
// and the writes HQ makes itself.
import { useEffect, useState } from 'react'
import type { PulseWaitingDirection } from '../../../../../shared/pulse-types'
import { translate } from '@/i18n/i18n'
import { isWebClientLocation } from '@/lib/web-client-location'
import { findPersonByName, readHqPulse, type HqPerson, type HqPulse } from './hq-pulse-snapshot'

export type HqPulseState =
  | { status: 'loading' }
  | { status: 'ready'; pulse: HqPulse }
  | { status: 'error'; message: string }

async function callPulse(method: string, params?: unknown): Promise<unknown> {
  const response = await window.api.runtime.call({ method, params })
  if (!response.ok) {
    throw new Error(response.error.message)
  }
  return response.result
}

export function useHqPulse(): HqPulseState {
  // Why: the paired web client has no bell bridge to hear changes; the desktop owns the pulse.
  const [state, setState] = useState<HqPulseState>(() =>
    isWebClientLocation()
      ? {
          status: 'error',
          message: translate('auto.hq.waiting.desktopOnly', 'open HQ in the desktop app')
        }
      : { status: 'loading' }
  )
  useEffect(() => {
    if (isWebClientLocation()) {
      return
    }
    let alive = true
    const load = (): void => {
      callPulse('pulse.snapshot')
        .then((result) => {
          if (!alive) {
            return
          }
          const pulse = readHqPulse(result)
          setState(
            pulse
              ? { status: 'ready', pulse }
              : { status: 'error', message: 'pulse snapshot has an unexpected shape' }
          )
        })
        .catch((error: unknown) => {
          if (alive) {
            setState({ status: 'error', message: String(error) })
          }
        })
    }
    load()
    const unsubscribe = window.api.pulseBell.onChanged(load)
    return () => {
      alive = false
      unsubscribe()
    }
  }, [])
  return state
}

async function personIdFor(people: readonly HqPerson[], name: string): Promise<string | null> {
  const trimmed = name.trim()
  if (!trimmed) {
    return null
  }
  const known = findPersonByName(people, trimmed)
  if (known) {
    return known.id
  }
  const created = await callPulse('pulse.upsertPerson', { name: trimmed })
  const id = typeof created === 'object' && created !== null ? Reflect.get(created, 'id') : null
  if (typeof id !== 'string') {
    throw new Error('pulse.upsertPerson returned no id')
  }
  return id
}

export async function addHqWaiting(args: {
  direction: PulseWaitingDirection
  title: string
  personName: string
  people: readonly HqPerson[]
  /** HQ slug of the project the waiting is about. */
  project?: string | null
}): Promise<void> {
  const personId = await personIdFor(args.people, args.personName)
  await callPulse('pulse.addWaiting', {
    direction: args.direction,
    title: args.title.trim(),
    source: 'manual',
    ...(personId ? { personId } : {}),
    ...(args.project ? { project: args.project } : {})
  })
}

export async function closeHqWaiting(id: string, status: 'resolved' | 'cancelled'): Promise<void> {
  await callPulse('pulse.closeWaiting', { id, status })
}

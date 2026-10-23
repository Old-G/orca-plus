// Custom build (hq): the pulse records behind HQ, refreshed whenever main reports a pulse write
// (in the paired web client, which hears no such report, after its own writes and every 30 s),
// and the writes HQ makes itself.
import { useEffect, useState } from 'react'
import type { PulseWaitingDirection } from '../../../../../shared/pulse-types'
import { isWebClientLocation } from '@/lib/web-client-location'
import { translate } from '@/i18n/i18n'
import {
  findPersonByName,
  readHqPulse,
  type HqPerson,
  type HqPulse
} from '../../../../../shared/hq-pulse-snapshot'

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

const WEB_POLL_MS = 30_000
const ownWriteListeners = new Set<() => void>()

async function writePulse(method: string, params: unknown): Promise<unknown> {
  const result = await callPulse(method, params)
  for (const listener of ownWriteListeners) {
    listener()
  }
  return result
}

export function useHqPulse(): HqPulseState {
  const [state, setState] = useState<HqPulseState>({ status: 'loading' })
  useEffect(() => {
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
              : {
                  status: 'error',
                  message: translate(
                    'auto.hq.pulse.badShape',
                    'pulse snapshot has an unexpected shape'
                  )
                }
          )
        })
        .catch((error: unknown) => {
          if (alive) {
            setState({ status: 'error', message: String(error) })
          }
        })
    }
    load()
    ownWriteListeners.add(load)
    const unsubscribe = window.api.pulseBell.onChanged(load)
    const poll = setInterval(() => {
      if (isWebClientLocation()) {
        load()
      }
    }, WEB_POLL_MS)
    return () => {
      alive = false
      ownWriteListeners.delete(load)
      unsubscribe()
      clearInterval(poll)
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
  const created = await writePulse('pulse.upsertPerson', { name: trimmed })
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
  /** Custom build (hq-notes): `note` for a plain note; `manual` otherwise. */
  source?: string
  dueAt?: number | null
  /** Custom build (hq-notes-dedup): add even when an open note already says the same. */
  allowDuplicate?: boolean
}): Promise<{ duplicateTitle: string | null }> {
  const personId = await personIdFor(args.people, args.personName)
  const added = await writePulse('pulse.addWaiting', {
    direction: args.direction,
    title: args.title.trim(),
    source: args.source ?? 'manual',
    ...(personId ? { personId } : {}),
    ...(args.project ? { project: args.project } : {}),
    ...(args.dueAt ? { dueAt: args.dueAt } : {}),
    ...(args.allowDuplicate ? { allowDuplicate: true } : {})
  })
  const duplicate =
    typeof added === 'object' && added !== null && Reflect.get(added, 'duplicate') === true
  const title = duplicate ? Reflect.get(added, 'title') : null
  return { duplicateTitle: typeof title === 'string' ? title : null }
}

/** Custom build (hq-plus-round6): a waiting's detail — where HQ+ keeps its task, snooze and checks. */
export async function updateHqWaitingDetail(id: string, detail: string | null): Promise<void> {
  await writePulse('pulse.updateWaiting', { id, detail })
}

export async function closeHqWaiting(id: string, status: 'resolved' | 'cancelled'): Promise<void> {
  await writePulse('pulse.closeWaiting', { id, status })
}

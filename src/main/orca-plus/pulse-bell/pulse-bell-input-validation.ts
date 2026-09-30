// Custom build (pulse-bell): the renderer sends inbox items for the kinds it owns; accept only well-formed ones.
import type { PulseBellInput } from '../../../shared/pulse-bell'
import type { PulseInboxAction } from '../../../shared/pulse-types'

const MAX_ITEMS = 20
const MAX_TEXT = 2_000

function readString(value: unknown, max = MAX_TEXT): string | null {
  return typeof value === 'string' && value.length > 0 && value.length <= max ? value : null
}

function readActions(value: unknown): PulseInboxAction[] {
  if (!Array.isArray(value)) {
    return []
  }
  return value.flatMap((entry: unknown) => {
    if (!entry || typeof entry !== 'object') {
      return []
    }
    const id = readString(Reflect.get(entry, 'id'), 64)
    const label = readString(Reflect.get(entry, 'label'), 120)
    return id && label ? [{ id, label }] : []
  })
}

export function readPulseBellInputs(value: unknown): PulseBellInput[] {
  if (!Array.isArray(value)) {
    return []
  }
  return value.slice(0, MAX_ITEMS).flatMap((entry: unknown) => {
    if (!entry || typeof entry !== 'object') {
      return []
    }
    const kind = readString(Reflect.get(entry, 'kind'), 64)
    const title = readString(Reflect.get(entry, 'title'))
    const dedupeKey = readString(Reflect.get(entry, 'dedupeKey'), 400)
    if (!kind || !title || !dedupeKey) {
      return []
    }
    const urgency =
      Reflect.get(entry, 'urgency') === 'urgent' ? ('urgent' as const) : ('normal' as const)
    return [
      {
        kind,
        title,
        dedupeKey,
        urgency,
        body: readString(Reflect.get(entry, 'body')),
        refKind: readString(Reflect.get(entry, 'refKind'), 64),
        refId: readString(Reflect.get(entry, 'refId'), 400),
        actions: readActions(Reflect.get(entry, 'actions'))
      }
    ]
  })
}

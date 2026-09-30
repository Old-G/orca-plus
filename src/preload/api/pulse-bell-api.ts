// Custom build (pulse-bell): the bell's inbox as the renderer sees it.
import type { PulseBellInput } from '../../shared/pulse-bell'
import type { PulseInboxItem } from '../../shared/pulse-types'

export type PulseBellApi = {
  list: () => Promise<PulseInboxItem[]>
  markRead: (ids: string[]) => Promise<void>
  markDone: (id: string, action?: string) => Promise<void>
  /** Only for the kinds the renderer owns (RENDERER_SYNCED_PULSE_BELL_KINDS). */
  syncKind: (kind: string, items: PulseBellInput[]) => Promise<void>
  onChanged: (callback: () => void) => () => void
}

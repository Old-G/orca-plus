// Custom build (hq-slack-intake): a «Later» line in Notes takes its message into work through the same
// «To work» card, while that card is still in the bell.
import { toast } from 'sonner'
import { hqIntakeKey } from '../../../../../shared/hq-slack-intake'
import { translate } from '@/i18n/i18n'
import { showHqIntakeCard } from '../pulse-bell/hq-intake-toasts'

export async function openHqIntakeFromNote(sourceRef: string): Promise<void> {
  const match = /^slack:([A-Z0-9]+):(\d+\.\d+)$/.exec(sourceRef)
  const key = match ? hqIntakeKey({ channel: match[1], ts: match[2] }) : null
  const item = key
    ? (await window.api.pulseBell.list()).find((entry) => entry.dedupeKey === key)
    : undefined
  if (!item || !showHqIntakeCard(item)) {
    toast.error(
      translate(
        'auto.hq.notes.intakeGone',
        'The message is no longer in the bell — open it in Slack and mark it with 👾 again'
      )
    )
  }
}

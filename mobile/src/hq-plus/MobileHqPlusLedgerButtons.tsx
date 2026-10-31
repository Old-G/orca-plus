// Custom build (hq-ledger-sources): the buttons of an MR or a mail thread no other card stands for in
// HQ+ on the phone — open it in the link sheet, or say Done through the Mac (a new message brings it
// back).
import type { HqPlusCard } from '../../../src/shared/hq-plus-log'
import { HqpButton, HqpButtons } from './mobile-hq-plus-parts'

export function MobileHqPlusLedgerButtons({
  card,
  busy,
  openLink,
  onDone
}: {
  card: HqPlusCard
  busy: string | null
  /** The link sheet: Orca browser, Safari, Copy link. */
  openLink: (url: string) => void
  onDone: () => void
}) {
  const link = card.conversation?.link?.startsWith('https://') ? card.conversation.link : null
  const yours = card.conversation?.ledgerState === 'you'
  return (
    <HqpButtons>
      {link ? (
        <HqpButton label="Open ↗" main={yours} ghost={!yours} onPress={() => openLink(link)} />
      ) : null}
      <HqpButton
        label={busy === 'done' ? 'Working…' : 'Done'}
        ghost
        disabled={busy !== null}
        onPress={onDone}
      />
    </HqpButtons>
  )
}

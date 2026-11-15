// Custom build (chat-continue-new, T6): the context ring's offer and the chat menu's item that move a
// big idle Claude chat on to a fresh one. Quiet by the owner's choice (15.11): nothing blocks Enter.
import { MessageSquarePlus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { useTranslate } from '@/i18n/use-translate'
import type { NativeChatContinueNew } from './native-chat-continue-new-context'
import { formatContextTokenCount } from '../../../../../shared/native-chat/native-chat-context-usage-summary'

/** «3 h», or «45 min» under an hour. */
export function formatNativeChatIdle(idleMs: number): string {
  const minutes = Math.max(1, Math.floor(idleMs / 60_000))
  return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h`
}

export function NativeChatContinueNewOffer({
  offer
}: {
  offer: NativeChatContinueNew
}): React.JSX.Element {
  const t = useTranslate()
  return (
    <div className="mt-3 border-t border-border pt-3" data-native-chat-continue-new="true">
      <p className="text-xs text-muted-foreground">
        {t(
          'components.native-chat.continueNew.note',
          'Idle {{idle}}. The next message here re-reads all {{tokens}} tokens from your limit.',
          {
            idle: formatNativeChatIdle(offer.idleMs),
            tokens: formatContextTokenCount(offer.usedTokens)
          }
        )}
      </p>
      <Button
        size="sm"
        className="mt-2 w-full"
        disabled={offer.starting}
        onClick={() => offer.start()}
      >
        <MessageSquarePlus className="size-4" />
        {t('components.native-chat.continueNew.action', 'Continue in new chat')}
      </Button>
    </div>
  )
}

export function NativeChatContinueNewMenuItem({
  onSelect,
  disabled = false
}: {
  onSelect: () => void
  disabled?: boolean
}): React.JSX.Element {
  const t = useTranslate()
  return (
    <DropdownMenuItem disabled={disabled} onSelect={onSelect}>
      <MessageSquarePlus />
      {t('components.native-chat.continueNew.action', 'Continue in new chat')}
    </DropdownMenuItem>
  )
}

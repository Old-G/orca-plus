// Custom build (chat-continue-new, T6): the context ring's offer and the chat menu's item that move a
// big idle Claude chat on to a fresh one. Variant B (owner 15.11): Enter in such a chat asks first, in a bar over the field.
import { MessageSquarePlus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { useTranslate } from '@/i18n/use-translate'
import type { NativeChatContinueNew } from './native-chat-continue-new-context'
import type { NativeChatContinueNewAsk } from './use-native-chat-continue-new-ask'
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
        onClick={() => void offer.start()}
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

/** Variant B: the bar over the field after Enter in a due chat. */
export function NativeChatContinueNewAskBar({
  ask
}: {
  ask: NativeChatContinueNewAsk
}): React.JSX.Element {
  const t = useTranslate()
  const { offer } = ask
  return (
    <div className="native-chat-composer-gutter shrink-0 bg-chat-pane pt-2">
      <div
        role="group"
        className="flex flex-wrap items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2"
        data-native-chat-continue-new-ask="true"
      >
        <p className="min-w-0 flex-1 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">
            {t(
              'components.native-chat.continueNew.askLead',
              'Idle {{idle}} · {{tokens}} context.',
              {
                idle: formatNativeChatIdle(offer.idleMs),
                tokens: formatContextTokenCount(offer.usedTokens)
              }
            )}
          </span>{' '}
          {t(
            'components.native-chat.continueNew.askNote',
            'Sending here re-reads the whole chat from your limit.'
          )}
        </p>
        <Button size="sm" disabled={offer.starting} onClick={() => ask.choose('new')}>
          <MessageSquarePlus className="size-4" />
          {t('components.native-chat.continueNew.askNew', 'New chat with this message')}
          <kbd className="text-xs opacity-70">⏎</kbd>
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={offer.starting}
          onClick={() => ask.choose('here')}
        >
          {t('components.native-chat.continueNew.askHere', 'Send here')}
        </Button>
      </div>
    </div>
  )
}

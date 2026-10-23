// Custom build (hq-chats): «HQ | Code» in the titlebar — HQ keeps the chat it
// showed, and Code opens that chat's project with the chat in front.
// Custom build (hq-plus-ui): «HQ+ | HQ | Code» — HQ+ is the feed of threads, HQ the classic screen.
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import { switchHqToCode } from './hq-chat-actions'
import { openHqScreen } from './hq-view'
import { setHqFlavor, useHqFlavor } from '../hq-plus/hq-plus-flavor'
import { useHqPopupsGoToFeed } from '../hq-plus/hq-plus-popups'
import { usePulseBellInbox } from '../pulse-bell/use-pulse-bell-inbox'
import { HQ_PLUS_CARD_KINDS } from '../../../../../shared/hq-plus-log'

// Why: the titlebar is a window-drag region; controls in it must opt out to take clicks.
const NO_DRAG: React.CSSProperties & { WebkitAppRegion: string } = { WebkitAppRegion: 'no-drag' }

export function HqModeSwitch(): React.JSX.Element {
  const inHq = useAppStore((state) => state.activeView === 'hq')
  const flavor = useHqFlavor()
  // Custom build (hq-plus-ui): popups land in HQ+, so its tab quietly counts what is new there.
  const toFeed = useHqPopupsGoToFeed()
  const inbox = usePulseBellInbox()
  const unread = toFeed
    ? inbox.filter((item) => item.readAt === null && HQ_PLUS_CARD_KINDS.has(item.kind)).length
    : 0
  const showUnread = unread > 0 && !(inHq && flavor === 'plus')
  return (
    <div className="ml-1 flex items-center" style={NO_DRAG}>
      <ToggleGroup
        type="single"
        variant="outline"
        size="sm"
        value={inHq ? (flavor === 'plus' ? 'hqplus' : 'hq') : 'code'}
        aria-label={translate('auto.hq.mode.label', 'Mode')}
        onValueChange={(value) => {
          if (value === 'hqplus') {
            setHqFlavor('plus')
            openHqScreen()
          } else if (value === 'hq') {
            setHqFlavor('classic')
            openHqScreen()
          } else if (value === 'code') {
            switchHqToCode()
          }
        }}
      >
        <ToggleGroupItem
          value="hqplus"
          aria-label={
            showUnread
              ? translate('auto.hq.mode.hqPlusUnread', 'HQ+, {{count}} new', { count: unread })
              : undefined
          }
        >
          {translate('auto.hq.mode.hqPlus', 'HQ+')}
          {showUnread ? (
            <span className="ml-1 font-mono text-[10px] text-muted-foreground tabular-nums">
              {unread}
            </span>
          ) : null}
        </ToggleGroupItem>
        <ToggleGroupItem value="hq">{translate('auto.hq.mode.hq', 'HQ')}</ToggleGroupItem>
        <ToggleGroupItem value="code">{translate('auto.hq.mode.code', 'Code')}</ToggleGroupItem>
      </ToggleGroup>
    </div>
  )
}

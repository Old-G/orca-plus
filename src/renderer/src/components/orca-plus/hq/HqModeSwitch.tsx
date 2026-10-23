// Custom build (hq-chats): «HQ | Code» in the titlebar — HQ keeps the chat it
// showed, and Code opens that chat's project with the chat in front.
// Custom build (hq-plus-ui): «HQ+ | HQ | Code» — HQ+ is the feed of threads, HQ the classic screen.
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import { switchHqToCode } from './hq-chat-actions'
import { openHqScreen } from './hq-view'
import { setHqFlavor, useHqFlavor } from '../hq-plus/hq-plus-flavor'

// Why: the titlebar is a window-drag region; controls in it must opt out to take clicks.
const NO_DRAG: React.CSSProperties & { WebkitAppRegion: string } = { WebkitAppRegion: 'no-drag' }

export function HqModeSwitch(): React.JSX.Element {
  const inHq = useAppStore((state) => state.activeView === 'hq')
  const flavor = useHqFlavor()
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
            openHqScreen('chats')
          } else if (value === 'code') {
            switchHqToCode()
          }
        }}
      >
        <ToggleGroupItem value="hqplus">{translate('auto.hq.mode.hqPlus', 'HQ+')}</ToggleGroupItem>
        <ToggleGroupItem value="hq">{translate('auto.hq.mode.hq', 'HQ')}</ToggleGroupItem>
        <ToggleGroupItem value="code">{translate('auto.hq.mode.code', 'Code')}</ToggleGroupItem>
      </ToggleGroup>
    </div>
  )
}

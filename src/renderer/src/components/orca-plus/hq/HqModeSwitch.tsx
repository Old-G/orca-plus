// Custom build (hq-chats): «HQ | Code» in the titlebar under Orca+'s «New view» — HQ keeps the chat it
// showed, and Code opens that chat's project with the chat in front.
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { translate } from '@/i18n/i18n'
import { useOrcaPlusNewView } from '@/lib/orca-plus-new-view'
import { useAppStore } from '@/store'
import { switchHqToCode } from './hq-chat-actions'
import { openHqScreen } from './hq-view'

// Why: the titlebar is a window-drag region; controls in it must opt out to take clicks.
const NO_DRAG: React.CSSProperties & { WebkitAppRegion: string } = { WebkitAppRegion: 'no-drag' }

export function HqModeSwitch(): React.JSX.Element | null {
  const newView = useOrcaPlusNewView()
  const inHq = useAppStore((state) => state.activeView === 'hq')
  if (!newView) {
    return null
  }
  return (
    <div className="ml-1 flex items-center" style={NO_DRAG}>
      <ToggleGroup
        type="single"
        variant="outline"
        size="sm"
        value={inHq ? 'hq' : 'code'}
        aria-label={translate('auto.hq.mode.label', 'Mode')}
        onValueChange={(value) => {
          if (value === 'hq') {
            openHqScreen('chats')
          } else if (value === 'code') {
            switchHqToCode()
          }
        }}
      >
        <ToggleGroupItem value="hq">{translate('auto.hq.mode.hq', 'HQ')}</ToggleGroupItem>
        <ToggleGroupItem value="code">{translate('auto.hq.mode.code', 'Code')}</ToggleGroupItem>
      </ToggleGroup>
    </div>
  )
}

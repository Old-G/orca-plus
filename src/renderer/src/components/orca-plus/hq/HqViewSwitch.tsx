// Custom build (hq-chats): the «New view» switch in HQ's header — the messenger view and the rest of
// the new look, or everything as it was; kept in settings, so either is a click away.
import { useId } from 'react'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { translate } from '@/i18n/i18n'
import { useOrcaPlusNewView } from '@/lib/orca-plus-new-view'
import { useAppStore } from '@/store'

export function HqViewSwitch(): React.JSX.Element {
  const id = useId()
  const on = useOrcaPlusNewView()
  return (
    <div className="flex shrink-0 items-center gap-2">
      <Switch
        id={id}
        checked={on}
        onCheckedChange={(checked) =>
          void useAppStore.getState().updateSettings({ hqChatsView: checked })
        }
      />
      <Label htmlFor={id}>
        <span className="text-xs text-muted-foreground">
          {translate('auto.hq.view.newView', 'New view')}
        </span>
      </Label>
    </div>
  )
}

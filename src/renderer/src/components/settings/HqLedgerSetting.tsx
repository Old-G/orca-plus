// Custom build (hq-request-ledger): whether the request ledger is off, reads beside the old cards in
// shadow, or is on — one card per Slack conversation in place of the mention cards.
import React from 'react'
import type { GlobalSettings } from '../../../../shared/global-settings-types'
import { Label } from '../ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'
import { SearchableSetting } from './SearchableSetting'
import { translate } from '@/i18n/i18n'

type HqLedgerMode = NonNullable<GlobalSettings['hqLedger']>
const MODES: readonly HqLedgerMode[] = ['off', 'shadow', 'on']

function isMode(value: string): value is HqLedgerMode {
  return MODES.some((mode) => mode === value)
}

export function HqLedgerSetting({
  settings,
  updateSettings
}: {
  settings: GlobalSettings
  updateSettings: (updates: Partial<GlobalSettings>) => void
}): React.JSX.Element | null {
  if (!settings.hqPath) {
    return null
  }
  const value = settings.hqLedger ?? 'shadow'
  const title = translate('auto.hq.ledger.settingTitle', 'Conversations')
  const description = translate(
    'auto.hq.ledger.settingDescription',
    'Slack DMs, threads you take part in and mentions are read every half minute into conversations. On: one card per conversation that waits on you, updated in place. Shadow: conversations are kept beside the old cards, nothing shown changes.'
  )
  return (
    <SearchableSetting
      title={title}
      description={description}
      keywords={['hq', 'hq+', 'ledger', 'conversations', 'slack', 'cards']}
      className="space-y-2"
    >
      <Label>{title}</Label>
      <Select
        value={value}
        onValueChange={(next) => {
          if (isMode(next)) {
            updateSettings({ hqLedger: next })
          }
        }}
      >
        <SelectTrigger size="sm" className="h-7 w-[140px] text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="off">{translate('auto.hq.ledger.off', 'Off')}</SelectItem>
          <SelectItem value="shadow">{translate('auto.hq.ledger.shadow', 'Shadow')}</SelectItem>
          <SelectItem value="on">{translate('auto.hq.ledger.on', 'On')}</SelectItem>
        </SelectContent>
      </Select>
      <p className="text-xs text-muted-foreground">{description}</p>
    </SearchableSetting>
  )
}

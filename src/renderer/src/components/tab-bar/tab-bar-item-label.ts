import type { TabBarItem } from './tab-bar-item-model'
import type { Tab } from '../../../../shared/tab-types'
import {
  resolveTerminalTabTitle,
  resolveUnifiedTabLabel
} from '../../../../shared/tab-title-resolution'
import { getEditorDisplayLabel } from '@/components/editor/editor-labels'
import { getBrowserTabLabel } from './BrowserTab'
import { formatSimulatorTabLabel } from '@/lib/simulator/tabs/simulator-tab-label'
import type { Translate } from '@/i18n/use-translate'

/** Custom build (native-chat-titles): a chat tab shows the conversation's own title; upstream's
 *  saved name only replaces the generic "Claude Chat" label. */
export function resolveAgentSessionTabTitle(
  tab: Tab,
  conversationName: string | null,
  generatedTitlesEnabled: boolean
): string {
  return resolveUnifiedTabLabel(
    { ...tab, label: conversationName ?? tab.label },
    generatedTitlesEnabled,
    tab.label
  )
}

export function tabItemLabel(
  item: TabBarItem,
  generatedTitlesEnabled: boolean,
  savedName: string | null,
  t?: Translate
): string {
  if (item.type === 'terminal') {
    return resolveTerminalTabTitle(item.data, generatedTitlesEnabled, item.data.title)
  }
  if (item.type === 'browser') {
    return getBrowserTabLabel(item.data, t)
  }
  if (item.type === 'agent-session') {
    return resolveAgentSessionTabTitle(item.data, savedName, generatedTitlesEnabled)
  }
  if (item.type === 'simulator') {
    return formatSimulatorTabLabel(item.data.label, t)
  }
  return getEditorDisplayLabel(item.data, undefined, t)
}

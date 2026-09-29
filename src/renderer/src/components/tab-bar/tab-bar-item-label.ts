import type { TabBarItem } from './tab-bar-item-model'
import type { Tab } from '../../../../shared/tab-types'
import {
  resolveTerminalTabTitle,
  resolveUnifiedTabLabel
} from '../../../../shared/tab-title-resolution'
import { getEditorDisplayLabel } from '@/components/editor/editor-labels'
import { getBrowserTabLabel } from './BrowserTab'
import { formatSimulatorTabLabel } from '@/lib/simulator-tab-label'

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
  savedName: string | null
): string {
  if (item.type === 'terminal') {
    return resolveTerminalTabTitle(item.data, generatedTitlesEnabled, item.data.title)
  }
  if (item.type === 'browser') {
    return getBrowserTabLabel(item.data)
  }
  if (item.type === 'agent-session') {
    return resolveAgentSessionTabTitle(item.data, savedName, generatedTitlesEnabled)
  }
  if (item.type === 'simulator') {
    return formatSimulatorTabLabel(item.data.label)
  }
  return getEditorDisplayLabel(item.data)
}

// Custom build (lean-mcp, L4): the switch for worker and review chats starting without the MCP
// servers nobody uses there. Full is the default and the old behaviour.
import React from 'react'
import type { GlobalSettings } from '../../../../../shared/settings/global-settings-types'
import { agentMcpProfile, type AgentMcpProfile } from '../../../../../shared/agent-lean-mcp'
import { SettingsRow, SettingsSegmentedControl } from '../form-controls/SettingsFormControls'
import { SearchableSetting } from '../section-layout/SearchableSetting'
import { translate } from '@/i18n/i18n'

export function agentMcpProfileSettingText(): { title: string; description: string } {
  return {
    title: translate(
      'auto.agents.mcpProfile.settingTitle',
      'MCP servers for worker and review chats'
    ),
    description: translate(
      'auto.agents.mcpProfile.settingDescription',
      'Full starts every chat with every MCP server, as before. Lean starts chats launched with --role worker or review without Gmail, Calendar, Google Analytics, Merchant, Search Console, Google Ads, Zoho, Odoo, WooCommerce and Meetings, so their tool lists and instructions are not loaded on every call. Leads and your own chats keep everything. Applies to chats that start after the change; change the list with agentLeanMcpDeny in settings.json.'
    )
  }
}

export function AgentMcpProfileSetting({
  settings,
  updateSettings
}: {
  settings: GlobalSettings
  updateSettings: (updates: Partial<GlobalSettings>) => void
}): React.JSX.Element {
  const { title, description } = agentMcpProfileSettingText()
  return (
    <SearchableSetting
      title={title}
      description={description}
      keywords={['mcp', 'lean', 'worker', 'review', 'tools', 'context', 'limits', 'tokens']}
    >
      <SettingsRow
        label={title}
        description={description}
        control={
          <SettingsSegmentedControl<AgentMcpProfile>
            ariaLabel={title}
            value={agentMcpProfile(settings)}
            onChange={(next) => updateSettings({ agentMcpProfile: next })}
            options={[
              { value: 'full', label: translate('auto.agents.mcpProfile.full', 'Full') },
              { value: 'lean', label: translate('auto.agents.mcpProfile.lean', 'Lean') }
            ]}
          />
        }
      />
    </SearchableSetting>
  )
}

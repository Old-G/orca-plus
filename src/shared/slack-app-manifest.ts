// Custom build (slack-core): the Slack app a user creates for Orca+. It asks for every scope the
// notifications and Socket Mode features use, so connecting once never needs a reinstall.

export const SLACK_BOT_SCOPES = [
  'chat:write',
  'im:write',
  'im:history',
  'users:read',
  'channels:read',
  'groups:read',
  'channels:history',
  'groups:history',
  'reactions:write',
  'commands'
] as const

export const SLACK_APP_MANIFEST = {
  display_information: {
    name: 'Orca Plus',
    description: 'Agent updates from Orca+, and replies back to your agents.',
    background_color: '#1d1d1f'
  },
  features: {
    app_home: {
      home_tab_enabled: false,
      messages_tab_enabled: true,
      messages_tab_read_only_enabled: false
    },
    bot_user: { display_name: 'orca-plus', always_online: true },
    slash_commands: [
      {
        command: '/orca',
        description: 'Start an agent in Orca+',
        usage_hint: '<repo> [agent] <task>',
        should_escape: false
      }
    ]
  },
  oauth_config: { scopes: { bot: [...SLACK_BOT_SCOPES] } },
  settings: {
    event_subscriptions: { bot_events: ['message.im', 'message.channels', 'message.groups'] },
    interactivity: { is_enabled: true },
    org_deploy_enabled: false,
    socket_mode_enabled: true,
    token_rotation_enabled: false
  }
}

/** Opens Slack's "create app" flow with the manifest prefilled. */
export function buildSlackCreateAppUrl(): string {
  const manifest = encodeURIComponent(JSON.stringify(SLACK_APP_MANIFEST))
  return `https://api.slack.com/apps?new_app=1&manifest_json=${manifest}`
}

export const SLACK_APPS_URL = 'https://api.slack.com/apps'

// Custom build (slack-core): Slack connection shapes shared by main, preload and Settings.

export type SlackPerson = {
  id: string
  name: string
}

/** Where agent updates go: the bot's DM with the owner, or one channel the bot was invited to. */
export type SlackTarget =
  | { kind: 'dm' }
  | { kind: 'channel'; channelId: string; channelName: string }

export type SlackConnectionStatus = {
  connected: boolean
  teamName: string | null
  bot: SlackPerson | null
  /** The only Slack user whose messages Orca acts on, and the recipient of DMs. */
  owner: SlackPerson | null
  target: SlackTarget
  credentialError?: string
}

export type SlackConnectInput = {
  botToken: string
  appToken: string
  ownerId: string
}

export type SlackConnectResult = { ok: true; owner: SlackPerson } | { ok: false; error: string }

export type SlackMutationResult = { ok: true } | { ok: false; error: string }

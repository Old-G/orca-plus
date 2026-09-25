import type {
  SlackConnectInput,
  SlackConnectResult,
  SlackConnectionStatus,
  SlackMutationResult
} from '../../shared/slack-types'

export type SlackApi = {
  connect: (args: SlackConnectInput) => Promise<SlackConnectResult>
  disconnect: () => Promise<void>
  status: () => Promise<SlackConnectionStatus>
  sendTest: () => Promise<SlackMutationResult>
  setTarget: (
    args: { kind: 'dm' } | { kind: 'channel'; channel: string }
  ) => Promise<SlackMutationResult>
}

import type {
  SlackConnectInput,
  SlackConnectResult,
  SlackConnectionStatus,
  SlackMutationResult,
  SlackReaderConnectResult
} from '../../shared/slack-types'

export type SlackApi = {
  connect: (args: SlackConnectInput) => Promise<SlackConnectResult>
  disconnect: () => Promise<void>
  status: () => Promise<SlackConnectionStatus>
  sendTest: () => Promise<SlackMutationResult>
  setTarget: (
    args: { kind: 'dm' } | { kind: 'channel'; channel: string }
  ) => Promise<SlackMutationResult>
  /** Custom build (slack-reply-reader): the owner's xoxp- token that reads answers. */
  connectReader: (token: string) => Promise<SlackReaderConnectResult>
  disconnectReader: () => Promise<void>
}

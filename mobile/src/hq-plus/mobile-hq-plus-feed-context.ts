// Custom build (hq-plus-phone): what every row of HQ+'s phone feed reaches for — the Mac, the chat
// behind a row, a project's colour, and the screen's sheets a button opens.
import type { HqChatWireItem } from '../../../src/shared/hq-chat-wire'
import type { RpcClient } from '../transport/rpc-client'

export type HqpFeedContext = {
  client: RpcClient | null
  /** HQ's folder on the Mac: the caller a thread message comes from. */
  hqPath: string | null
  chatOf: (sessionId: string | null) => HqChatWireItem | null
  colorOf: (project: string | null) => string | null
  openChat: (chat: HqChatWireItem) => void
  /** The link sheet: Orca browser, Safari, Copy link. */
  openLink: (url: string) => void
  openReport: (path: string) => void
  onChanged: () => void
}

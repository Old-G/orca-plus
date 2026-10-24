// Custom build (hq-plus-phone): what HQ+ on the phone reads from the Mac, polled while the screen is
// open (the phone has no bell stream) — the feed, the rooms, the chats, the waits and the people.
// Lighter than the desktop's reads: the feed from the start of the day (what the log shows; open
// decisions come however old), and the waits only while the drawer or a view needs them.
import { useCallback } from 'react'
import { readHqChatWireList, type HqChatWireItem } from '../../../src/shared/hq-chat-wire'
import { hqPlusDayStart } from '../../../src/shared/hq-plus-log'
import type { HqFeedResult } from '../../../src/shared/hq-plus-screen'
import type { HqPulse } from '../../../src/shared/hq-pulse-snapshot'
import type { HqSpace } from '../../../src/shared/hq-spaces'
import { hqPulseRead } from '../hq/hq-operations'
import { hqChatListRead, hqSpacesRead } from '../hq/hq-messenger-operations'
import { errorText, useMobileHqPoll } from '../hq/use-mobile-hq-poll'
import { runRpcOperation } from '../transport/rpc-operation'
import type { RpcClient } from '../transport/rpc-client'
import { hqPlusFeedRead, isHqPlusMacTooOld } from './hq-plus-phone-operations'

/** Shown instead of an error when the Mac predates HQ+ on the phone. */
export const HQ_PLUS_MAC_TOO_OLD = 'Update Orca+ on the Mac to use HQ+ on the phone.'

type Read<T> = (client: RpcClient) => Promise<{ value: T } | { error: string }>

function reader<T>(read: (client: RpcClient) => Promise<T>): Read<T> {
  return async (client) => {
    try {
      return { value: await read(client) }
    } catch (error) {
      return { error: isHqPlusMacTooOld(error) ? HQ_PLUS_MAC_TOO_OLD : errorText(error) }
    }
  }
}

const readFeed = reader<HqFeedResult>((client) =>
  runRpcOperation(client, hqPlusFeedRead, { since: hqPlusDayStart(Date.now()) })
)
const readSpaces = reader<HqSpace[]>(
  async (client) => (await runRpcOperation(client, hqSpacesRead)).spaces
)
const readChats = reader<HqChatWireItem[]>(
  async (client) => readHqChatWireList(await runRpcOperation(client, hqChatListRead))?.items ?? []
)
const readPulse = reader<HqPulse>((client) => runRpcOperation(client, hqPulseRead))

export type HqPlusPhoneData = {
  feed: HqFeedResult | null
  spaces: HqSpace[]
  chats: HqChatWireItem[]
  pulse: HqPulse | null
  /** The feed's own failure: the screen has nothing to show without it. */
  error: string | null
  loading: boolean
  reload: () => void
}

export function useHqPlusPhoneData(
  client: RpcClient | null,
  /** The drawer or a view is open: the waits and people are read too. */
  wantsPulse: boolean
): HqPlusPhoneData {
  const feed = useMobileHqPoll(client, readFeed)
  const spaces = useMobileHqPoll(client, readSpaces)
  const chats = useMobileHqPoll(client, readChats)
  const pulse = useMobileHqPoll(wantsPulse ? client : null, readPulse)
  const { refresh: refreshFeed } = feed
  const { refresh: refreshChats } = chats
  const { refresh: refreshPulse } = pulse
  const reload = useCallback(() => {
    refreshFeed()
    refreshChats()
    refreshPulse()
  }, [refreshFeed, refreshChats, refreshPulse])
  return {
    feed: feed.state.status === 'ready' ? feed.state.value : null,
    spaces: spaces.state.status === 'ready' ? spaces.state.value : [],
    chats: chats.state.status === 'ready' ? chats.state.value : [],
    pulse: pulse.state.status === 'ready' ? pulse.state.value : null,
    error: feed.state.status === 'error' ? feed.state.message : null,
    loading: feed.state.status === 'loading',
    reload
  }
}

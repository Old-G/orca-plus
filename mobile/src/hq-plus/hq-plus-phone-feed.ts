// Custom build (hq-plus-phone): HQ+'s feed on the phone, built by the desktop's own rules from
// src/shared — the day's log, one row per chat, chats the journal does not know yet, the room and the
// chip filter — so the phone never decides what the feed shows on its own.
import type { HqChatWireItem } from '../../../src/shared/hq-chat-wire'
import {
  HQ_PLUS_ANY_ROOM,
  hqPlusDayStart,
  hqPlusLog,
  type HqPlusCard,
  type HqPlusLogItem
} from '../../../src/shared/hq-plus-log'
import {
  hqPlusFoldChats,
  hqPlusLiftActiveChats,
  hqPlusWithLiveChats,
  type HqPlusLiveChat
} from '../../../src/shared/hq-plus-fold'
import {
  hqPlusInFeedFilter,
  hqPlusMatchesSearch,
  type HqPlusFeedFilter
} from '../../../src/shared/hq-plus-feed-filter'
import { hqPlusNeedsOwner } from '../../../src/shared/hq-plus-kinds'
import type { HqFeedResult } from '../../../src/shared/hq-plus-screen'
import { hqSpaceOf, type HqSpace } from '../../../src/shared/hq-spaces'

const NATIVE_CHAT_TAB = /structured-agent-session-([^:/\s]+)$/

/** The native chat's session; an older Mac sends none, and its key still ends in the chat's tab. */
export function hqPlusPhoneChatSession(item: HqChatWireItem): string | null {
  return item.sessionId ?? NATIVE_CHAT_TAB.exec(item.key)?.[1] ?? null
}

/** The room a project or repo belongs to; what no room claims sits in the default one. */
export function hqPlusPhoneRoomOf(
  spaces: readonly HqSpace[],
  ref: { repoId?: string | null; project?: string | null }
): string {
  return (
    hqSpaceOf(spaces, ref)?.slug ??
    spaces.find((space) => space.isDefault)?.slug ??
    HQ_PLUS_ANY_ROOM
  )
}

/**
 * The phone's stand-in for the desktop's live chats: what works or waits now, and what finished or
 * opened today. The phone's list knows when a chat last moved, not when its tab opened.
 */
export function hqPlusPhoneLiveChats(
  chats: readonly HqChatWireItem[],
  spaces: readonly HqSpace[],
  since: number
): HqPlusLiveChat[] {
  return chats.flatMap((item) => {
    const sessionId = hqPlusPhoneChatSession(item)
    const busy = item.group === 'working' || item.group === 'needs'
    if (!sessionId || (!busy && item.sortAt < since)) {
      return []
    }
    return [
      {
        sessionId,
        project: item.projectName,
        room: hqPlusPhoneRoomOf(spaces, { repoId: item.repoId, project: item.projectName }),
        title: item.title || item.projectName,
        at: item.sortAt,
        activeAt: item.group === 'quiet' ? null : item.sortAt
      }
    ]
  })
}

export type HqPlusPhoneFeed = {
  /** Every room's rows, for the counts on the room tabs. */
  all: HqPlusLogItem[]
  /** What the feed shows: this room, chip and search. */
  items: HqPlusLogItem[]
  /** «Waiting on you», oldest first. */
  waiting: HqPlusCard[]
  /** Open decisions per room slug. */
  openByRoom: Map<string, number>
  /** Requests and reports still open in this room, for the Inbox chip. */
  inboxOpen: number
}

export function hqPlusPhoneFeed(input: {
  feed: HqFeedResult | null
  spaces: readonly HqSpace[]
  chats: readonly HqChatWireItem[]
  room: string | null
  filter: HqPlusFeedFilter
  query: string
  personName: (personId: string) => string | null
  now: number
}): HqPlusPhoneFeed {
  const dayStart = hqPlusDayStart(input.now)
  const projectRoom = new Map<string, string>()
  for (const space of input.spaces) {
    for (const project of space.projects) {
      projectRoom.set(project, space.slug)
    }
  }
  // Why: a bell item knows its project, not its room; HQ's rooms place it, as on the desktop.
  const all = (
    input.feed ? hqPlusLog(input.feed.entries, input.feed.inbox ?? [], dayStart) : []
  ).map((item) =>
    item.room === HQ_PLUS_ANY_ROOM && item.project && projectRoom.has(item.project)
      ? { ...item, room: projectRoom.get(item.project) ?? item.room }
      : item
  )
  const inRoom = (item: { room: string }): boolean => !input.room || item.room === input.room
  const roomItems = all.filter(inRoom)
  const live = hqPlusPhoneLiveChats(input.chats, input.spaces, dayStart).filter(inRoom)
  const shown = hqPlusLiftActiveChats(hqPlusFoldChats(hqPlusWithLiveChats(roomItems, live)), live)
  const query = input.query.trim()
  const items = shown.filter(
    (item) =>
      hqPlusInFeedFilter(item, input.filter) &&
      (!query || hqPlusMatchesSearch(item, query, input.personName))
  )
  const openByRoom = new Map<string, number>()
  for (const item of all) {
    if (hqPlusNeedsOwner(item)) {
      openByRoom.set(item.room, (openByRoom.get(item.room) ?? 0) + 1)
    }
  }
  return {
    all,
    items,
    waiting: roomItems.filter((item): item is HqPlusCard => hqPlusNeedsOwner(item)),
    openByRoom,
    inboxOpen: roomItems.filter(
      (item) => item.kind === 'card' && item.open && hqPlusInFeedFilter(item, 'inbox')
    ).length
  }
}

/** The phone's own chat row behind a feed row, to open it in the session screen. */
export function hqPlusPhoneChatOf(
  chats: readonly HqChatWireItem[],
  sessionId: string | null
): HqChatWireItem | null {
  return sessionId
    ? (chats.find((item) => hqPlusPhoneChatSession(item) === sessionId) ?? null)
    : null
}

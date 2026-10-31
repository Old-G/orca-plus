// Custom build (hq-project-cards): the phone's project cards from what it already reads — the room's rows,
// its waits on people, its open chats and today's journal rows — fed to the desktop's own model in
// src/shared, so the phone's feed and project screen show the desktop's cards.
import type { HqChatWireItem } from '../../../src/shared/hq-chat-wire'
import type { HqFeedResult } from '../../../src/shared/hq-plus-screen'
import type { HqPlusLogItem } from '../../../src/shared/hq-plus-log'
import type { HqPlusProjectInput } from '../../../src/shared/hq-plus-project-cards'
import type { HqSpace } from '../../../src/shared/hq-spaces'
import { hqPlusPhoneChatSession, hqPlusPhoneRoomOf } from './hq-plus-phone-feed'
import { hqPlusPhoneAnswers, hqPlusPhoneChatState, type HqpMapWait } from './hq-plus-phone-map'

export function hqPlusPhoneProjectInput(input: {
  feed: HqFeedResult | null
  spaces: readonly HqSpace[]
  /** The picked room; null for All. */
  room: string | null
  /** The room's rows as the feed shows them, before the chip. */
  shown: readonly HqPlusLogItem[]
  waits: readonly HqpMapWait[]
  chats: readonly HqChatWireItem[]
  since: number
}): HqPlusProjectInput {
  const answers = hqPlusPhoneAnswers(input.shown)
  const slugs = new Set(input.spaces.map((space) => space.slug))
  return {
    items: input.shown,
    waits: input.waits.flatMap((wait) =>
      wait.direction === 'on-them'
        ? [
            {
              id: wait.id,
              personName: wait.who,
              project: wait.project,
              title: wait.title,
              at: wait.createdAt,
              answerId: answers.get(wait.id) ?? null
            }
          ]
        : []
    ),
    chats: input.chats.flatMap((chat) => {
      const state = hqPlusPhoneChatState(chat)
      return state
        ? [
            {
              key: chat.key,
              project: chat.projectName,
              state,
              sessionId: hqPlusPhoneChatSession(chat),
              title: chat.title || chat.projectName,
              at: chat.sortAt
            }
          ]
        : []
    }),
    entries: (input.feed?.entries ?? []).filter(
      (entry) =>
        !input.room ||
        (slugs.has(entry.workspace)
          ? entry.workspace
          : hqPlusPhoneRoomOf(input.spaces, { project: entry.project })) === input.room
    ),
    since: input.since
  }
}

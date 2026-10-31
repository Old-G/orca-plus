// Custom build (hq-plus-phone-map): the desktop Map's model fed from what the phone already reads —
// the day's log, the waits on people, the open chats — one model per room (All lists every room), so
// the phone's tiles and project screen count by the desktop's own rules.
import type { HqChatWireGroup, HqChatWireItem } from '../../../src/shared/hq-chat-wire'
import type { HqPlusCard, HqPlusLogItem } from '../../../src/shared/hq-plus-log'
import {
  hqPlusMapFeedPlace,
  hqPlusMapModel,
  hqPlusMapProjectOf,
  type HqPlusMapChatState,
  type HqPlusMapModel
} from '../../../src/shared/hq-plus-map'
import type { HqWaiting } from '../../../src/shared/hq-pulse-snapshot'
import type { HqSpace } from '../../../src/shared/hq-spaces'
import { readHqWaitingReplyRef } from '../../../src/shared/hq-waiting-reply-bell'
import { hqPlusPhoneChatSession, hqPlusPhoneRoomOf } from './hq-plus-phone-feed'

const NATIVE_CHAT_TAB = 'structured-agent-session-'

/** The desktop's chat groups as the map's states; «active» repeats other rows and stays off. */
const CHAT_STATE: Partial<Record<HqChatWireGroup, HqPlusMapChatState>> = {
  needs: 'asks',
  working: 'working',
  done: 'done',
  quiet: 'quiet'
}

export const HQP_CHAT_STATE_LABEL: Record<HqPlusMapChatState, string> = {
  asks: 'asks you',
  working: 'working',
  done: 'done',
  quiet: 'quiet'
}

export function hqPlusPhoneChatState(item: HqChatWireItem): HqPlusMapChatState | null {
  return CHAT_STATE[item.group] ?? null
}

/** The chat's tab on the Mac, for `session.tabs.close`; null when the phone cannot name it. */
export function hqPlusPhoneChatTabId(item: HqChatWireItem): string | null {
  const sessionId = hqPlusPhoneChatSession(item)
  if (sessionId) {
    return `${NATIVE_CHAT_TAB}${sessionId}`
  }
  // Why: a terminal chat's pane key is its tab id with the pane's leaf after a colon.
  const tab = item.paneKey?.split(':')[0]
  return tab || null
}

/** A long project name may wrap after its «_» and «-», not mid-word. */
export function hqPlusPhoneBreakName(name: string): string {
  return name.replace(/([_-])/g, '$1​')
}

/** A wait on someone, as the phone reads it, with the person's name looked up. */
export type HqpMapWait = HqWaiting & { who: string | null }

export type HqpMapRoom = {
  slug: string
  name: string
  color: string
  model: HqPlusMapModel
  /** The room's open chats (the map's states only). */
  chats: HqChatWireItem[]
  /** The room's rows, for the project screen's cards. */
  items: HqPlusLogItem[]
}

/** The open card that holds a waiting's answer, by waiting id — as the desktop's answerOfWaiting. */
export function hqPlusPhoneAnswers(items: readonly HqPlusLogItem[]): Map<string, string> {
  const answers = new Map<string, string>()
  for (const item of items) {
    if (item.kind !== 'card' || item.type !== 'reply' || !item.open) {
      continue
    }
    const waitingId = readHqWaitingReplyRef(item.inbox?.refId ?? null)?.waitingId
    if (waitingId) {
      answers.set(waitingId, item.id)
    }
  }
  return answers
}

/** The rooms the map shows: the picked one, or every room in order for All. */
export function hqPlusPhoneMapRooms(input: {
  spaces: readonly HqSpace[]
  /** The picked room; null for All. */
  room: string | null
  /** Every room's rows (the phone feed's `all`). */
  items: readonly HqPlusLogItem[]
  waits: readonly HqpMapWait[]
  chats: readonly HqChatWireItem[]
}): HqpMapRoom[] {
  const answers = hqPlusPhoneAnswers(input.items)
  const shown = input.room
    ? input.spaces.filter((space) => space.slug === input.room)
    : input.spaces
  return shown.map((space) => {
    const roomOf = (ref: { repoId?: string | null; project?: string | null }): string =>
      hqPlusPhoneRoomOf(input.spaces, ref)
    const items = input.items.filter((item) => item.room === space.slug)
    const chats = input.chats.filter(
      (chat) =>
        hqPlusPhoneChatState(chat) !== null &&
        roomOf({ repoId: chat.repoId, project: chat.projectName }) === space.slug
    )
    const waits = input.waits.filter(
      (wait) => wait.direction === 'on-them' && roomOf({ project: wait.project }) === space.slug
    )
    const model = hqPlusMapModel({
      projects: space.projects,
      items,
      waits: waits.map((wait) => ({
        id: wait.id,
        personName: wait.who,
        project: wait.project,
        title: wait.title,
        at: wait.createdAt,
        answerId: answers.get(wait.id) ?? null
      })),
      chats: chats.map((chat) => ({
        key: chat.key,
        project: chat.projectName,
        state: hqPlusPhoneChatState(chat) ?? 'quiet',
        sessionId: hqPlusPhoneChatSession(chat)
      }))
    })
    return { slug: space.slug, name: space.name, color: space.color, model, chats, items }
  })
}

/** The cards waiting on the owner in one project, newest first — the desktop dock's «Your move». */
export function hqPlusPhoneProjectCards(
  items: readonly HqPlusLogItem[],
  slug: string
): HqPlusCard[] {
  return items
    .filter(
      (item): item is HqPlusCard =>
        item.kind === 'card' &&
        hqPlusMapFeedPlace(item) === 'you' &&
        hqPlusMapProjectOf(item) === slug
    )
    .toReversed()
}

/** A project's open chats, the one asking first. */
export function hqPlusPhoneProjectChats(
  chats: readonly HqChatWireItem[],
  slug: string
): HqChatWireItem[] {
  const order: HqPlusMapChatState[] = ['asks', 'working', 'done', 'quiet']
  return chats
    .filter((chat) => chat.projectName === slug)
    .toSorted(
      (a, b) =>
        order.indexOf(hqPlusPhoneChatState(a) ?? 'quiet') -
        order.indexOf(hqPlusPhoneChatState(b) ?? 'quiet')
    )
}

/** Whole days since a moment, for «oldest wait 3 d». */
export function hqPlusPhoneDays(at: number, now: number): number {
  return Math.max(0, Math.floor((now - at) / 86_400_000))
}

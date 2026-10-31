// Custom build (hq-request-ledger): the HQ project a chat works in — its workspace's repo (or, for a
// chat with no record, the repo its folder is in) as HQ's registry names it, the mapping that places
// journal rows. A folder HQ does not know stays null: its name is never taken for a project.
import { hqPlaceOf, type HqRoomSources } from './hq-journal-rooms'

export type HqChatRef = {
  worktreeId?: string | null
  /** The chat's Orca session id; its workspace is looked up. */
  sessionId?: string | null
  cwd?: string | null
}

export function hqProjectOfChat(sources: HqRoomSources, chat: HqChatRef): string | null {
  if (!chat.worktreeId && !chat.sessionId && !chat.cwd) {
    return null
  }
  return hqPlaceOf(sources, {
    worktreeId: chat.worktreeId ?? null,
    sessionId: chat.sessionId ?? null,
    cwd: chat.cwd ?? null
  }).project
}

export type HqChatProjects = {
  /** By the rooms as last read; null until they were read once. */
  now: (chat: HqChatRef) => string | null
  /** Reads the rooms again (HQ caches its own files) and answers by them. */
  read: (chat: HqChatRef) => Promise<string | null>
}

export function createHqChatProjects(
  readSources: () => Promise<HqRoomSources | null>
): HqChatProjects {
  let last: HqRoomSources | null = null
  const refresh = async (): Promise<HqRoomSources | null> => {
    last = (await readSources().catch(() => null)) ?? last
    return last
  }
  return {
    now: (chat) => (last ? hqProjectOfChat(last, chat) : null),
    read: async (chat) => {
      const sources = await refresh()
      return sources ? hqProjectOfChat(sources, chat) : null
    }
  }
}

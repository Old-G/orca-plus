// Custom build (hq-plus-phone-map): what the phone's Map needs beside the feed — the rooms' models
// (only while the Map shows), × that closes a chat's tab on the Mac, and the project's workspace.
import { useCallback, useMemo, useState } from 'react'
import type { HqChatWireItem } from '../../../src/shared/hq-chat-wire'
import type { HqPlusLogItem } from '../../../src/shared/hq-plus-log'
import type { HqSpace } from '../../../src/shared/hq-spaces'
import { sessionTabClose } from '../session/mobile-session-write-operations'
import type { RpcClient } from '../transport/rpc-client'
import {
  hqPlusPhoneChatTabId,
  hqPlusPhoneMapRooms,
  type HqpMapRoom,
  type HqpMapWait
} from './hq-plus-phone-map'

export type HqpMapPick = { room: string; slug: string }

export type HqPlusPhoneMap = {
  /** The project on its screen; null while the Map shows (and always on the Feed). */
  project: HqpMapPick | null
  setProject: (project: HqpMapPick | null) => void
  /** The open chats' sheet. */
  sheet: boolean
  setSheet: (open: boolean) => void
  rooms: HqpMapRoom[]
  /** The shown rooms' open chats, for «Chats · N». */
  chats: HqChatWireItem[]
  /** × on a chat; null without the Mac. */
  closeChat: ((chat: HqChatWireItem) => void) | null
  /** The project's workspace screen, when the phone knows one of its workspaces. */
  workspaceOf: (slug: string) => (() => void) | null
}

export function useHqPlusPhoneMap(input: {
  shown: boolean
  client: RpcClient | null
  hostId: string | null
  spaces: readonly HqSpace[]
  room: string | null
  items: readonly HqPlusLogItem[]
  waits: readonly HqpMapWait[]
  /** The room's chats, every chat for All. */
  chats: readonly HqChatWireItem[]
  push: (href: string) => void
  onNotice: (text: string) => void
  onChanged: () => void
}): HqPlusPhoneMap {
  const { shown, client, hostId, spaces, room, items, waits, push, onNotice, onChanged } = input
  // Why: a closed chat leaves at once; the next read of the chat list confirms it.
  const [project, setProject] = useState<HqpMapPick | null>(null)
  const [sheet, setSheet] = useState(false)
  const [closed, setClosed] = useState<ReadonlySet<string>>(new Set())
  const chats = useMemo(
    () => input.chats.filter((chat) => !closed.has(chat.key)),
    [input.chats, closed]
  )
  const rooms = useMemo(
    () => (shown ? hqPlusPhoneMapRooms({ spaces, room, items, waits, chats }) : []),
    [shown, spaces, room, items, waits, chats]
  )
  const roomChats = useMemo(() => rooms.flatMap((entry) => entry.chats), [rooms])
  const closeChat = useCallback(
    (chat: HqChatWireItem) => {
      const tabId = hqPlusPhoneChatTabId(chat)
      if (!client || !tabId) {
        return
      }
      const name = chat.title || chat.projectName
      void sessionTabClose
        .request(client, { worktree: `id:${chat.worktreeId}`, tabId, reason: 'user' })
        .then((raw) => {
          const reply = sessionTabClose.interpret(raw)
          if (reply.accepted && !reply.value.refused) {
            setClosed((previous) => new Set([...previous, chat.key]))
            onNotice(`Closed «${name}». It stays in History.`)
            onChanged()
          } else {
            onNotice(`The Mac did not close «${name}».`)
          }
        })
        .catch(() => onNotice(`Could not reach the Mac to close «${name}».`))
    },
    [client, onNotice, onChanged]
  )
  const workspaceOf = useCallback(
    (slug: string) => {
      const chat = input.chats.find((item) => item.projectName === slug)
      if (!hostId || !chat) {
        return null
      }
      const href = `/h/${encodeURIComponent(hostId)}/session/${encodeURIComponent(chat.worktreeId)}?name=${encodeURIComponent(slug)}`
      return () => push(href)
    },
    [input.chats, hostId, push]
  )
  return {
    project: shown ? project : null,
    setProject,
    sheet: shown && sheet,
    setSheet,
    rooms,
    chats: roomChats,
    closeChat: client ? closeChat : null,
    workspaceOf
  }
}

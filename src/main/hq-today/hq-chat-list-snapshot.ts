// Custom build (hq-mobile-messenger): the HQ chat list the desktop window last published, for the
// phone's HQ. Empty until a window publishes; the window republishes as its list changes.
import {
  HqChatWireItemSchema,
  type HqChatWireItem,
  type HqChatWireList
} from '../../shared/hq-chat-wire'

let latest: HqChatWireList = { items: [], publishedAt: 0 }

/** Keeps what parses; a malformed row is dropped, not the whole list. */
export function publishHqChatList(raw: unknown, now = Date.now()): number {
  const items = (Array.isArray(raw) ? raw : []).slice(0, 500).flatMap((entry): HqChatWireItem[] => {
    const parsed = HqChatWireItemSchema.safeParse(entry)
    return parsed.success ? [parsed.data] : []
  })
  latest = { items, publishedAt: now }
  return items.length
}

export function readHqChatList(): HqChatWireList {
  return latest
}

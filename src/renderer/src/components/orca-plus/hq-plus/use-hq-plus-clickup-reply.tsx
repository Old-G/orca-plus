// Custom build (hq-plus-clickup-reply): «Reply» on a ClickUp comment in HQ+ opened the classic HQ's
// Today, which HQ+ does not show, so nothing happened (owner 06.11). Here the reply box opens in the
// card itself: HQ drafts the answer from the task's comments, the owner edits it, Send posts it.
import { useState } from 'react'
import { HQ_SLACK_REQUEST_ACTION } from '../../../../../shared/hq-slack-request-bell'
import type { PulseInboxItem } from '../../../../../shared/pulse-types'
import { HqClickUpReplyComposer } from '../slack-requests/HqClickUpReplyComposer'

/** The scout's request id of a ClickUp comment's bell item; null for anything else. */
export function hqPlusClickUpRequestId(item: PulseInboxItem | null): string | null {
  try {
    const parsed: unknown = item?.refId ? JSON.parse(item.refId) : null
    const id: unknown = parsed && typeof parsed === 'object' ? Reflect.get(parsed, 'id') : null
    return typeof id === 'string' && id.startsWith('clickup:') ? id : null
  } catch {
    return null
  }
}

export function useHqPlusClickUpReply(onSent: () => void): {
  /** True when the click opened the reply box; anything else runs as before. */
  start: (item: PulseInboxItem, actionId: string) => boolean
  composer: React.JSX.Element | null
} {
  const [id, setId] = useState<string | null>(null)
  const start = (item: PulseInboxItem, actionId: string): boolean => {
    const requestId =
      actionId === HQ_SLACK_REQUEST_ACTION.answer ? hqPlusClickUpRequestId(item) : null
    if (requestId) {
      setId(requestId)
    }
    return requestId !== null
  }
  const composer = id ? (
    <HqClickUpReplyComposer
      key={id}
      id={id}
      onSent={() => {
        setId(null)
        onSent()
      }}
      onCancel={() => setId(null)}
    />
  ) : null
  return { start, composer }
}

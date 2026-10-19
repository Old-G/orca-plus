// Custom build (hq-clickup-review): «Разобрать» on a ClickUp change — Claude looks into it in the task's
// project, out of the owner's way; the card waits for its draft comment, and its chat opens in HQ.
import { toast } from 'sonner'
import type { HqSlackScoutDraft } from '../../../../../shared/hq-slack-scout'
import { translate } from '@/i18n/i18n'
import { hqChatKey } from '../hq/hq-chat-list'
import { openHqChat } from '../hq/hq-chat-open'

type ReviewChat = NonNullable<HqSlackScoutDraft['review']>

/** The review's chat in HQ; false when the host did not say which tab it is. */
export function openHqClickUpReviewChat(chat: Pick<ReviewChat, 'worktreeId' | 'tabId'>): boolean {
  if (!chat.tabId) {
    return false
  }
  openHqChat(hqChatKey(chat.worktreeId, chat.tabId))
  return true
}

/** Starts (or finds) the chat; the card stays until its draft is sent or skipped. */
export async function reviewHqClickUpRequest(id: string): Promise<void> {
  const start = window.api.hqProjects.startClickUpReview
  if (!start) {
    toast.error(translate('auto.hq.clickup.reviewOnMac', 'Start this on your Mac.'))
    return
  }
  const result = await start({ id }).catch((error: unknown) => ({
    ok: false as const,
    error: String(error)
  }))
  if (!result.ok) {
    toast.error(result.error)
    return
  }
  toast.success(
    translate(
      'auto.hq.clickup.reviewStarted',
      'Claude is looking into it; the draft comment comes back to this card.'
    ),
    result.tabId
      ? {
          action: {
            label: translate('auto.hq.clickup.openChat', 'Open chat'),
            onClick: () => void openHqClickUpReviewChat(result)
          }
        }
      : undefined
  )
}

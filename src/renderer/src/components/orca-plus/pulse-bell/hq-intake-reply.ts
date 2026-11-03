// Custom build (hq-ledger-draft, plan 20.9): «Reply» on a ledger card — an HQ chat sends the reply HQ
// already drafted, and Approve holds it for the owner to read and edit. The scout's «Just reply» had
// the chat write the answer from nothing; here it starts from the draft the card shows.
import { toast } from 'sonner'
import { readHqIntake } from '../../../../../shared/hq-slack-intake'
import {
  HQ_TONE_GUIDE_PATH,
  hqIntakeReplyPrompt
} from '../../../../../shared/hq-slack-request-prompts'
import { HQ_REPLY_CORRECTIONS_FILE, HQ_SLACK_SCOUT_DIR } from '../../../../../shared/hq-slack-scout'
import type { PulseInboxItem } from '../../../../../shared/pulse-types'
import { translate } from '@/i18n/i18n'
import { joinPath } from '@/lib/path'
import { useAppStore } from '@/store'
import { findHqWorktreeId, launchHqCommand } from '../hq/hq-today-actions'

export async function replyToHqIntake(item: PulseInboxItem): Promise<boolean> {
  const intake = readHqIntake(item.refId)
  const state = useAppStore.getState()
  const hq = state.settings?.hqPath ?? null
  const hqWorktreeId = findHqWorktreeId(hq, state.repos, state.worktreesByRepo)
  if (!intake?.replyDraft || !hq || !hqWorktreeId) {
    toast.error(translate('auto.hqIntake.replyNoHq', 'No HQ chat to send the reply from'))
    return false
  }
  const prompt = hqIntakeReplyPrompt(
    { channelId: intake.channel, threadTs: intake.threadTs, permalink: intake.permalink ?? '' },
    intake.replyDraft,
    {
      tonePath: joinPath(hq, HQ_TONE_GUIDE_PATH),
      correctionsPath: joinPath(hq, `${HQ_SLACK_SCOUT_DIR}/${HQ_REPLY_CORRECTIONS_FILE}`)
    }
  )
  const launched = launchHqCommand(hqWorktreeId, prompt)
  if (!launched.ok) {
    toast.error(launched.message)
    return false
  }
  // Why open (Codex 03.11): nothing is sent yet; a rejected or failed send must leave the card. Once
  // the reply goes out, his line in the talk takes it off his move and the card goes by itself.
  await window.api.pulseBell.markRead([item.id])
  toast.success(
    translate('auto.hqIntake.replyStarted', 'The reply waits for your approval in Approve.')
  )
  return true
}

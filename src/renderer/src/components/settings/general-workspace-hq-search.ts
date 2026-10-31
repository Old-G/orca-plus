// Custom build (hq-plus-ui): the HQ switches of Settings → Workspace, found by search; kept apart
// from general-search so that file stays within its size limit.
import type { SettingsSearchEntry } from './settings-search'
import { translate } from '@/i18n/i18n'

export function getGeneralWorkspaceHqSearchEntries(): SettingsSearchEntry[] {
  return [
    // Custom build (chat-cleanup): found by search too, not only by scrolling to it.
    {
      title: translate('auto.hq.chatCleanup.settingTitle', 'Close quiet chats'),
      description: translate(
        'auto.hq.chatCleanup.settingDescription',
        'A chat read after it finished closes after 12 hours, any chat after a quiet day — like its ×, so History reopens it. Chats that work, wait for you or for an answer, pinned or marked ones stay. Report only lists them in HQ Reports.'
      ),
      keywords: ['hq', 'chats', 'close', 'cleanup', 'tabs', 'sessions']
    },
    // Custom build (hq-plus-ui)
    {
      title: translate(
        'auto.hqPlus.popups.settingTitle',
        'Show HQ events in the HQ+ feed instead of popups'
      ),
      description: translate(
        'auto.hqPlus.popups.settingDescription',
        "Finished chats, Approve, Slack requests, people's answers, limits and handoffs become cards in HQ+ with an unread count on HQ+, instead of toasts on the right. Off brings the toasts back. Desktop and phone notifications are not changed."
      ),
      keywords: ['hq', 'hq+', 'toasts', 'popups', 'feed', 'notifications']
    },
    // Custom build (hq-plus-sessions)
    {
      title: translate('auto.hq.sessionDispatcher.settingTitle', 'Session dispatcher'),
      description: translate(
        'auto.hq.sessionDispatcher.settingDescription',
        'Work handed to a thread goes to its chat while it has room and was active in the last 12 hours, else to a new chat that starts from the last report. A chat you are in is left alone; a project gets at most two live chats. Report only writes what it would do to the HQ+ journal. Handoffs have their own switch below.'
      ),
      keywords: ['hq', 'hq+', 'sessions', 'chats', 'dispatcher', 'handoff', 'queue']
    },
    // Custom build (hq-handoff-auto)
    {
      title: translate('auto.hq.handoffAutoStart.settingTitle', 'New chat after a handoff'),
      description: translate(
        'auto.hq.handoffAutoStart.settingDescription',
        'When a chat runs out of context and saves a handoff, a new chat in the same project starts from it in the background about 20 seconds later and the old one closes to History. A chat on your screen is left for your own click; a chat stopped on a limit waits until it lifts. Works whatever the session dispatcher is set to.'
      ),
      keywords: ['hq', 'hq+', 'handoff', 'context', 'new chat', 'continue', 'sessions']
    },
    // Custom build (hq-request-ledger)
    {
      title: translate('auto.hq.ledger.settingTitle', 'Conversations'),
      description: translate(
        'auto.hq.ledger.settingDescription',
        'Slack DMs, threads you take part in and mentions are read every half minute into conversations. On: one card per conversation that waits on you, updated in place. Shadow: conversations are kept beside the old cards, nothing shown changes.'
      ),
      keywords: ['hq', 'hq+', 'ledger', 'conversations', 'slack', 'cards']
    }
  ]
}

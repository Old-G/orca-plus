// Custom build (hq-plus-ticker): one emoji per Live line (renderer only: shared code stays ASCII), so what kind of thing came in reads at a glance.
import { HQ_JOURNAL_KIND } from '../../../../../shared/hq-journal'
import type { HqPlusLogItem } from '../../../../../shared/hq-plus-log'

const CARD_MARK: Readonly<Record<string, string>> = {
  move: '❓',
  approve: '✋',
  reply: '🗣️',
  wait: '⏳',
  report: '📄',
  bell: '🔔'
}

const LINE_MARK: Readonly<Record<string, string>> = {
  [HQ_JOURNAL_KIND.chatReport]: '🤖',
  [HQ_JOURNAL_KIND.personReply]: '🗣️',
  [HQ_JOURNAL_KIND.waitingOpen]: '⏳',
  [HQ_JOURNAL_KIND.waitingDone]: '✅',
  [HQ_JOURNAL_KIND.approveResult]: '✅',
  [HQ_JOURNAL_KIND.reviewFinding]: '🔎',
  [HQ_JOURNAL_KIND.chatMessage]: '✉️',
  [HQ_JOURNAL_KIND.sessionHandoff]: '🔁',
  [HQ_JOURNAL_KIND.sessionOpen]: '🚀',
  [HQ_JOURNAL_KIND.sessionContinue]: '▶️',
  [HQ_JOURNAL_KIND.sessionQueued]: '📥',
  [HQ_JOURNAL_KIND.sessionClose]: '💤',
  [HQ_JOURNAL_KIND.jobReport]: '⚙️',
  // Why: bell items that land as lines keep their bell kind.
  'agent-finished': '🤖',
  'agent-waiting': '🤖',
  handoff: '🔁',
  'slack-request': '💬',
  'hq-intake': '💬'
}

export function hqPlusTickerMark(item: HqPlusLogItem): string {
  if (item.kind === 'me') {
    return '👉'
  }
  if (item.kind === 'card') {
    // Why: a decided card is news now; only an open one still asks the owner.
    if (!item.open) {
      return '✅'
    }
    const bellMark = item.type === 'bell' ? LINE_MARK[item.inbox?.kind ?? ''] : undefined
    return bellMark ?? CARD_MARK[item.type] ?? '🔔'
  }
  if (item.tone === 'person') {
    return '🗣️'
  }
  return LINE_MARK[item.journalKind ?? ''] ?? (item.tone === 'agent' ? '🤖' : '🔹')
}

// Custom build (hq-task-progress, C7): what `orca hq task-event` tells the chat.
import type { HqTaskProgressResult } from '../shared/hq-task-progress'

export function formatHqTaskEvent(result: HqTaskProgressResult): string {
  if (!result.ok) {
    const why = {
      off: 'plan row progress is off (setting hqTaskProgressEnabled).',
      'no-row': 'this chat holds no plan row — nothing written.',
      'no-hq': 'no HQ folder is set (Settings → Workspace → HQ).'
    }[result.reason]
    return `Not written: ${why}`
  }
  return result.rows
    .map((row) => {
      const name = `${row.plan}/${row.row}.md`
      if (row.status === 'written') {
        return `${name}: ${row.line}`
      }
      return row.status === 'skipped'
        ? `${name}: not a safe name, nothing written.`
        : `${name}: already there, nothing added.`
    })
    .join('\n')
}

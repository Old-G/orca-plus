// Custom build (hq-lead-of, A1): what `orca hq lead` prints.
import type { HqLeadResult } from '../shared/hq-lead-of'

export function formatHqLead(lead: HqLeadResult): string {
  const name = lead.address ? `${lead.address} (${lead.sessionId})` : lead.sessionId
  const state = lead.open === null ? '' : lead.open ? ' — open' : ' — closed'
  const lines = [`Lead of ${lead.plan}: ${name}${state}`]
  if (lead.handedOffFrom) {
    lines.push(`The plan names ${lead.handedOffFrom}; it handed off to this chat.`)
  }
  if (lead.open === false) {
    lines.push(
      'Its chat is closed: a send to it is refused. Bring it back with `orca chat send lead --revive "…"`, or tell the owner.'
    )
  } else {
    lines.push('Send to it: orca chat send lead "…"')
  }
  return lines.join('\n')
}

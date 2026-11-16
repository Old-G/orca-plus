// Custom build (hq-lead-reassign): what `orca hq reassign` moved, kept, rewrote and told.
import type { HqLeadReassignChat, HqLeadReassignResult } from '../shared/hq-chat-links'

function ref(chat: HqLeadReassignChat): string {
  return chat.address ?? chat.sessionId
}

function line(chat: HqLeadReassignChat): string {
  return `${ref(chat)}${chat.address ? ` (${chat.sessionId})` : ''}${chat.name ? ` — ${chat.name}` : ''}`
}

export function formatHqReassign(result: HqLeadReassignResult): string {
  const from = ref(result.from)
  const to = ref(result.to)
  const out: string[] = []
  if (result.moved.length === 0) {
    out.push(`Nothing to move: no open chat of ${from} goes to ${to}.`)
  } else {
    out.push(
      result.dryRun
        ? `Would move ${result.moved.length} chat(s) from ${from} to ${to} (dry run, nothing changed):`
        : `Moved ${result.moved.length} chat(s) from ${from} to ${to}:`
    )
    for (const chat of result.moved) {
      out.push(
        `  ${line(chat)}${result.dryRun ? '' : chat.told ? ' — told' : ' — not told (closed or busy); the forward still reaches the new Lead'}`
      )
    }
  }
  if (result.kept.length > 0) {
    out.push('Kept with the old Lead:')
    for (const chat of result.kept) {
      out.push(`  ${line(chat)} — ${chat.why}`)
    }
  }
  if (result.plans.length > 0) {
    out.push(
      `${result.dryRun ? 'Would rewrite' : 'Rewrote'} «Lead chat:» in: ${result.plans.join(', ')}`
    )
  }
  if (!result.dryRun && result.moved.length > 0) {
    const held = result.heldHandedOver > 0 ? `, with ${result.heldHandedOver} held message(s)` : ''
    const newLead = result.toldNewLead ? 'told' : 'NOT told (send it the list yourself)'
    const oldLead = result.toldOldLead ? 'told' : 'not told (closed)'
    out.push(`New Lead ${newLead}${held}; old Lead ${oldLead}.`)
    out.push(
      `Undo: orca hq reassign --from ${to} --to ${from} --chats ${result.moved.map(ref).join(',')}`
    )
  }
  return out.join('\n')
}

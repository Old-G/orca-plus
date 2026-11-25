// Custom build (hq-lead-reassign): what `orca hq reassign` moved, kept, rewrote and told.
import { basename } from 'node:path'
import { quoteCliCommandArgument } from './arguments/shell-command-quote'
import {
  HQ_REASSIGN_NO_LEAD,
  type HqLeadReassignChat,
  type HqLeadReassignResult
} from '../shared/hq-chat-links'

/** A chat's thread, else its session id; `none` for no Lead (T13) — what --from and --to take. */
function ref(chat: HqLeadReassignChat | null): string {
  return chat ? (chat.address ?? chat.sessionId) : HQ_REASSIGN_NO_LEAD
}

function line(chat: HqLeadReassignChat): string {
  return `${ref(chat)}${chat.address ? ` (${chat.sessionId})` : ''}${chat.name ? ` — ${chat.name}` : ''}`
}

export function formatHqReassign(result: HqLeadReassignResult): string {
  const from = ref(result.from)
  const to = ref(result.to)
  const span = !result.from
    ? `that had no Lead to ${to}`
    : !result.to
      ? `of ${from} back to no Lead`
      : `from ${from} to ${to}`
  const out: string[] = []
  if (result.moved.length === 0) {
    out.push(
      result.from
        ? `Nothing to move: no open chat of ${from} goes to ${to}.`
        : `Nothing to move to ${to}.`
    )
  } else {
    out.push(
      result.dryRun
        ? `Would move ${result.moved.length} chat(s) ${span} (dry run, nothing changed):`
        : `Moved ${result.moved.length} chat(s) ${span}:`
    )
    for (const chat of result.moved) {
      out.push(
        `  ${line(chat)}${result.dryRun ? '' : chat.told ? ' — told' : result.from && result.to ? ' — not told (closed or busy); the forward still reaches the new Lead' : ' — not told (closed or busy)'}`
      )
    }
  }
  if (result.kept.length > 0) {
    out.push(result.from ? 'Kept with the old Lead:' : 'Not moved:')
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
    const told = [
      result.to ? `New Lead ${newLead}${held}` : null,
      result.from ? `${result.to ? 'old' : 'Old'} Lead ${oldLead}` : null
    ]
    out.push(`${told.filter(Boolean).join('; ')}.`)
    // Why quoted: a plan named «2026-11-19 Billing.md» would split into two arguments when pasted.
    // Why --plans: --chats alone leaves the plan lines a whole team's move rewrote with the new Lead.
    const plans =
      result.plans.length > 0
        ? ` --plans ${quoteCliCommandArgument(result.plans.map((plan) => basename(plan)).join(','))}`
        : ''
    out.push(
      `Undo: orca hq reassign --from ${to} --to ${from} --chats ${result.moved.map(ref).join(',')}${plans}`
    )
  }
  return out.join('\n')
}

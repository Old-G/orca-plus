import { describe, expect, it } from 'vitest'
import { formatHqReassign } from './hq-reassign-format'

function undoLine(plans: string[]): string {
  const text = formatHqReassign({
    dryRun: false,
    from: { sessionId: 'claude_l1', address: 'hq/lead-payouts', name: null },
    to: { sessionId: 'claude_l2', address: 'hq/lead-billing', name: null },
    moved: [
      {
        sessionId: 'claude_w1',
        address: 'acme-api/w-report',
        name: null,
        told: true
      }
    ],
    kept: [],
    plans,
    heldHandedOver: 0,
    toldNewLead: true,
    toldOldLead: true
  })
  return text.split('\n').find((line) => line.startsWith('Undo: ')) ?? ''
}

describe.runIf(process.platform !== 'win32')('formatHqReassign undo', () => {
  it('quotes a plan file name with a space so the pasted undo keeps it whole', () => {
    expect(undoLine(['/hq/runs/2026-11-19 Billing.md', '/hq/runs/2026-11-16-payouts.md'])).toBe(
      "Undo: orca hq reassign --from hq/lead-billing --to hq/lead-payouts --chats acme-api/w-report --plans '2026-11-19 Billing.md,2026-11-16-payouts.md'"
    )
  })

  it('leaves plain plan names bare', () => {
    expect(undoLine(['/hq/runs/2026-11-16-payouts.md'])).toMatch(/ --plans 2026-11-16-payouts\.md$/)
  })
})

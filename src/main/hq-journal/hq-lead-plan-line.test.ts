import { describe, expect, it } from 'vitest'
import { hqPlanLeadRefs, hqRewriteLeadLines } from './hq-lead-plan-line'

const AT = new Date(2026, 10, 16, 12).getTime()
const FROM = { address: 'hq/lead-old', sessionIds: ['claude_aaa', 'claude_bbb'] }
const TO = { address: 'hq/lead-new', sessionId: 'claude_ccc' }

describe('the plan line «Lead chat:»', () => {
  it('names the new Lead and keeps the old one as «(was: …)» and the rest of the line', () => {
    const text = 'Lead chat: hq/lead-old (claude_bbb) · started 14.11 · go: «yes»\n| # |'
    expect(hqRewriteLeadLines(text, FROM, TO, AT)).toBe(
      'Lead chat: `hq/lead-new` (claude_ccc) (was: `hq/lead-old`, 16.11) · started 14.11 · go: «yes»\n| # |'
    )
  })

  it('finds the Lead in backticks, by an earlier session, and on a sub-lead line', () => {
    const text = [
      '- **Lead chat:** `hq/other` (claude_zzz)',
      'Sub-lead chat: `hq/lead-old` (claude_aaa с 15.11; до — claude_xxx) · started 15.11'
    ].join('\n')
    expect(hqRewriteLeadLines(text, FROM, TO, AT)?.split('\n')).toEqual([
      '- **Lead chat:** `hq/other` (claude_zzz)',
      'Sub-lead chat: `hq/lead-new` (claude_ccc) (was: `hq/lead-old`, 16.11) · started 15.11'
    ])
  })

  it('leaves a plan that names the old Lead only as one it had before', () => {
    const was = 'Lead chat: `hq/lead-x` (claude_x) (was: `hq/lead-old`, claude_aaa) · started 1.11'
    const russian = 'Lead chat: `hq/lead-x` (claude_x) (был: `hq/lead-old`) · started 1.11'
    expect(hqRewriteLeadLines(was, FROM, TO, AT)).toBeNull()
    expect(hqRewriteLeadLines(russian, FROM, TO, AT)).toBeNull()
  })

  it('writes the session id alone for a new Lead with no thread yet', () => {
    expect(
      hqRewriteLeadLines(
        'Lead chat: hq/lead-old (claude_aaa)',
        FROM,
        { address: null, sessionId: 'claude_ddd' },
        AT
      )
    ).toBe('Lead chat: claude_ddd (was: `hq/lead-old`, 16.11)')
  })
})

describe('hqPlanLeadRefs (T2)', () => {
  it('splits the current Lead from «(was: …)» and skips Sub-lead lines', () => {
    const text = [
      '# Plan',
      'Lead chat: `acme/lead-2` (s-2) (was: `acme/lead-1`, 26.11) · started 26.11',
      'Sub-lead chat: acme/sub (s-3)',
      'Lead chat: acme/lead-9 (s-9) · started'
    ].join('\n')
    expect(hqPlanLeadRefs('plan.md', text)).toEqual([
      { file: 'plan.md', current: ['acme/lead-2', 's-2'], was: ['acme/lead-1', '26.11'], text },
      { file: 'plan.md', current: ['acme/lead-9', 's-9'], was: [], text }
    ])
  })
})

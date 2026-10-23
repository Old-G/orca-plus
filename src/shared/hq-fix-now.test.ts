import { describe, expect, it } from 'vitest'
import type { HqRouteAction } from './hq-routing'
import { hqFixNowSummary } from './hq-fix-now'

const action = (over: Partial<HqRouteAction>): HqRouteAction => ({
  kind: 'open',
  project: 'acme-api',
  workspace: 'acme',
  findings: ['e-1'],
  level: 2,
  address: 'acme-api/codex-fix-2026-10-24',
  sessionId: 'claude_1',
  note: null,
  ...over
})

describe('«Fix now» result line', () => {
  it('names the chats it opened and what was already handled', () => {
    expect(
      hqFixNowSummary({
        actions: [
          action({}),
          action({ project: 'kite', kind: 'continue' }),
          action({ project: 'zen', kind: 'suggest', sessionId: null }),
          action({ project: 'web', sessionId: null, note: 'no repo' })
        ],
        handled: [
          {
            project: 'orca-custom',
            title: '[P1] Settle the question',
            address: 'orca-custom/codex-fix-2026-10-23',
            commit: '6fca74d8ee'
          }
        ]
      })
    ).toEqual({
      ok: true,
      // Why: web did not start, so the report stays open for another «Fix now».
      complete: false,
      text: 'Opened 1 fixing chat: acme-api · handed to today’s chat: kite · asks you first (autonomy 0): zen · did not start: web (no repo) · already handled: orca-custom P1 (6fca74d8ee)'
    })
  })

  it('says so when nothing was left, and when the report has nothing at all', () => {
    expect(
      hqFixNowSummary({
        actions: [],
        handled: [{ project: 'kite', title: '[P2] Nit', address: 'kite/codex-fix', commit: null }]
      })
    ).toEqual({
      ok: true,
      complete: true,
      text: 'All findings already handled — kite P2 (kite/codex-fix)'
    })
    expect(hqFixNowSummary({ actions: [], handled: [] })).toEqual({
      ok: false,
      complete: false,
      text: 'This report has no findings in the journal.'
    })
  })
})

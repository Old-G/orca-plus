import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { HQ_JOURNAL_KIND } from '../../shared/hq-journal'
import { PulseDb } from '../orca-plus/pulse/pulse-db'
import { codexReviewJournal } from '../hq-journal/hq-journal-codex-review'
import { hqReviewedCommits } from './hq-routing-codex-fix'
import { createHqRouting, type HqRoutingService } from './hq-routing'

const REPORT_NAME = 'codex-review-2026-10-24T18-50.md'
const REPORT = `# Codex за день — Acme API, Kite — 24.10

## Acme API · коммитов: 2

- **[P1] Refund cap ignores partial refunds** — \`src/refund.ts:40-44\`
  A second partial refund passes the cap.
- **[P2] Log line repeats the amount** — \`src/refund.ts:51\`

Коммиты: \`1111111aaa\`, \`2222222bbb\`

## Kite · коммитов: 1

- **[P0] Token written to the log** — \`src/auth.ts:9\`

Коммиты: \`3333333ccc\`
`
const ROUTING = `review.finding:
  - when: {sev: [P0, P1]}
    at: "19:00"
    do: open_session
    since: 2026-10-24
  - when: {sev: [P2]}
    do: collect
`
const AUTONOMY = 'default: 1\nprojects:\n  kite: 0\n'
const at = (hours: number, minutes = 0): number => new Date(2026, 9, 24, hours, minutes).getTime()

let db: PulseDb
let clock: number
let routing: HqRoutingService
let launched: { repoId: string; name: string; baseBranch?: string }[]
let delivered: { sessionId: string; prompt: string }[]
let launchError: string | null
let free: number | null

beforeEach(() => {
  db = new PulseDb(':memory:')
  clock = at(18, 55)
  launched = []
  delivered = []
  launchError = null
  free = 80
  const rooms: Record<string, string> = { 'Acme API': 'acme-api', Kite: 'kite' }
  db.recordJournal(
    codexReviewJournal(REPORT_NAME, REPORT, ({ project }) => ({
      room: project === 'Kite' ? 'hobby' : 'acme',
      project: rooms[project ?? ''] ?? null,
      hq: false,
      firm: true
    }))
  )
  const files: Record<string, string> = {
    '/hq/routing.yaml': ROUTING,
    '/hq/autonomy.yaml': AUTONOMY,
    [`/hq/updates/${REPORT_NAME}`]: REPORT
  }
  routing = createHqRouting({
    enabled: () => true,
    hqPath: () => '/hq',
    readText: async (path) => files[path] ?? null,
    pulse: {
      list: (query) => db.listJournal(query),
      record: (inputs) => db.recordJournal(inputs),
      noteSessions: (inputs) => db.noteSessions(inputs)
    },
    workspaceFor: async (project) =>
      project === 'acme-api' ? { repoId: 'r-api', repoPath: '/w/api', name: 'Acme API' } : null,
    baseBranch: async (_repo, commits) =>
      commits.includes('2222222bbb') ? 'feature/refunds' : null,
    launch: async (target) => {
      if (launchError) {
        return { ok: false, error: launchError }
      }
      launched.push(target)
      return {
        ok: true,
        sessionId: `claude_fix${launched.length}`,
        worktreeId: 'r-api::/w/api-fix'
      }
    },
    limit: async () => true,
    nameChat: async () => {},
    deliver: async (sessionId, prompt) => {
      delivered.push({ sessionId, prompt })
      return true
    },
    freePercent: () => free,
    now: () => clock,
    log: () => {}
  })
})

afterEach(() => db.close())

const findings = () => db.listJournal({ kind: HQ_JOURNAL_KIND.reviewFinding, oldestFirst: true })

describe('HQ+ routing: Codex findings to a fixing chat', () => {
  it('waits for the hour, then opens one chat per project from the reviewed branch', async () => {
    expect((await routing.run()).actions).toEqual([])
    clock = at(21, 40)
    const result = await routing.run()
    expect(result.actions.map((action) => [action.project, action.kind])).toEqual([
      ['acme-api', 'open'],
      ['kite', 'suggest']
    ])
    expect(launched).toEqual([
      { repoId: 'r-api', name: 'codex-fix-2026-10-24-2140', baseBranch: 'feature/refunds' }
    ])
    const [refund, minor, token] = findings()
    expect(refund).toMatchObject({ address: 'acme-api/codex-fix-2026-10-24', status: 'open' })
    expect(minor).toMatchObject({ address: null, status: 'done' })
    expect(token.address).toBeNull()
    expect(delivered[0].prompt).toContain(refund.id)
    expect(delivered[0].prompt).toContain('A second partial refund passes the cap.')
    expect(delivered[0].prompt).not.toContain('Log line repeats')
    expect(db.getSession('claude_fix1')).toMatchObject({
      address: 'acme-api/codex-fix-2026-10-24',
      workspace: 'acme'
    })
    expect(db.listJournal({ kind: 'routing.action', needs: 'owner' })).toMatchObject([
      { project: 'kite', workspace: 'hobby' }
    ])

    clock = at(21, 45)
    const again = await routing.run()
    expect(again.actions.map((action) => action.kind)).toEqual(['suggest'])
    expect(launched).toHaveLength(1)
    expect(db.listJournal({ kind: 'routing.action', needs: 'owner' })).toHaveLength(1)
  })

  it('takes nothing older than the rule, and waits while the Claude limit is low', async () => {
    clock = at(19, 5)
    free = 10
    expect(
      (await routing.run()).actions.find((action) => action.project === 'acme-api')
    ).toMatchObject({
      kind: 'wait',
      note: 'Claude limit 10% free < 20%'
    })
    expect(launched).toEqual([])
    const past = await routing.run({ dryRun: true, manual: true, since: at(19, 0) })
    expect(past.actions).toEqual([])
  })

  it('a failed launch tells the owner once and tries again within the hour', async () => {
    clock = at(19, 0)
    launchError = 'no repo'
    await routing.run()
    clock = at(19, 30)
    launchError = null
    expect((await routing.run()).actions[0]).toMatchObject({ kind: 'wait' })
    expect(db.listJournal({ needs: 'owner:decide' }).map((row) => row.title)).toContain(
      'Codex: 1 finding in acme-api — the fixing chat did not start: no repo'
    )
    clock = at(20, 1)
    expect((await routing.run()).actions[0]).toMatchObject({ kind: 'open' })
  })

  it('finds the commits the evening read for a finding, in both report shapes', () => {
    expect(hqReviewedCommits(REPORT, ['[P0] Token written to the log'])).toEqual(['3333333ccc'])
    expect(
      hqReviewedCommits('## Acme · `4444444ddd` Cap refunds\n\n- **[P1] Cap is off** — `a.ts`\n', [
        '[P1] Cap is off'
      ])
    ).toEqual(['4444444ddd'])
  })
})

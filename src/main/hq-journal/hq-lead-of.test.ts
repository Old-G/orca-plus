import { mkdtemp, mkdir, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { HqSession } from '../../shared/hq-journal'
import { createHqLeadOf, hqReadPlanTexts, type HqPlanText } from './hq-lead-of'

const LEAD_1 = '11111111-1111-4111-8111-111111111111'
const LEAD_2 = '22222222-2222-4222-8222-222222222222'
const LEAD_3 = '33333333-3333-4333-8333-333333333333'
const WORKER = '99d7951c-0000-4000-8000-000000000000'

function session(sessionId: string, address: string | null, project = 'hq'): HqSession {
  return {
    sessionId,
    address,
    agent: 'claude',
    worktreeId: null,
    workspace: 'acme',
    project,
    state: 'working',
    contextPct: null,
    openedAt: 0,
    lastActivityAt: 0,
    closedAt: null,
    parentSessionId: null,
    taskRef: null
  }
}

const SESSIONS = new Map<string, HqSession>([
  [LEAD_1, session(LEAD_1, 'hq/lead-refunds')],
  [LEAD_2, session(LEAD_2, 'hq/lead-refunds-2')],
  [LEAD_3, session(LEAD_3, 'hq/lead-refunds-2')],
  [WORKER, session(WORKER, 'acme-api/w-refund-cap', 'acme-api')]
])

function plan(file: string, leadLine: string, rows: string, mtimeMs = 1): HqPlanText {
  return {
    file,
    mtimeMs,
    text: `# LEAD · Refunds\n${leadLine} · started 2026-11-28 · go: «yes»\n\n| # | Task | Chat |\n|---|---|---|\n${rows}\n`
  }
}

function leadOf(
  plans: HqPlanText[],
  options: { open?: string[] | null; live?: Record<string, string> } = {}
) {
  return createHqLeadOf({
    plans: async () => plans,
    getSession: (id) => SESSIONS.get(id) ?? null,
    listSessionsByAddress: (address) =>
      [...SESSIONS.values()].filter((one) => one.address === address).toReversed(),
    liveSessionOf: (id) => options.live?.[id] ?? id,
    openTabs: () => (options.open === null ? null : new Set(options.open ?? [LEAD_2, WORKER]))
  })
}

const NOW = plan(
  '2026-11-28-refunds.md',
  `Lead chat: \`hq/lead-refunds-2\` (${LEAD_2}) (was: \`hq/lead-refunds\`, 28.11)`,
  `| T1 | Refund cap | acme-api/w-refund-cap (99d7951c) |`
)

describe('orca hq lead (hq-lead-of, A1)', () => {
  it('reads the Lead from the «Lead chat:» line of the plan that names the chat, not the «was»', async () => {
    await expect(leadOf([NOW])({ sessionId: WORKER })).resolves.toEqual({
      plan: '2026-11-28-refunds.md',
      address: 'hq/lead-refunds-2',
      sessionId: LEAD_2,
      open: true
    })
  })

  it('finds the plan by the chat address alone, and by --plan with or without .md', async () => {
    const byAddress = plan(
      'a.md',
      `Lead chat: \`hq/lead-refunds-2\` (${LEAD_2})`,
      '| T1 | Refund cap | `acme-api/w-refund-cap` |'
    )
    await expect(leadOf([byAddress])({ sessionId: WORKER })).resolves.toMatchObject({
      sessionId: LEAD_2
    })
    await expect(
      leadOf([byAddress, NOW])({ sessionId: null, plan: '2026-11-28-refunds' })
    ).resolves.toMatchObject({ plan: '2026-11-28-refunds.md', sessionId: LEAD_2 })
    await expect(leadOf([NOW])({ sessionId: null, plan: 'nope.md' })).rejects.toThrow(
      'No plan nope.md in HQ/runs.'
    )
  })

  it("does not take a longer address that starts with the chat's", async () => {
    const other = plan(
      'b.md',
      `Lead chat: \`hq/lead-refunds\` (${LEAD_1})`,
      '| T1 | Other | acme-api/w-refund-cap-2 |'
    )
    await expect(leadOf([other])({ sessionId: WORKER })).rejects.toThrow(
      /No plan in HQ\/runs names this chat \(acme-api\/w-refund-cap\)/
    )
  })

  it('follows a Lead that handed off to the chat that continues it', async () => {
    await expect(
      leadOf([NOW], { open: [LEAD_3], live: { [LEAD_2]: LEAD_3 } })({ sessionId: WORKER })
    ).resolves.toEqual({
      plan: '2026-11-28-refunds.md',
      address: 'hq/lead-refunds-2',
      sessionId: LEAD_3,
      open: true,
      handedOffFrom: LEAD_2
    })
  })

  it('says a closed Lead is closed, and the open tabs unknown as null', async () => {
    await expect(leadOf([NOW], { open: [WORKER] })({ sessionId: WORKER })).resolves.toMatchObject({
      sessionId: LEAD_2,
      open: false
    })
    await expect(leadOf([NOW], { open: null })({ sessionId: WORKER })).resolves.toMatchObject({
      open: null
    })
  })

  it('prefers the plan whose Lead is open, and refuses two open Leads', async () => {
    const old = plan(
      'old.md',
      `Lead chat: \`hq/lead-refunds\` (${LEAD_1})`,
      '| T0 | Refund cap | acme-api/w-refund-cap |'
    )
    await expect(leadOf([old, NOW])({ sessionId: WORKER })).resolves.toMatchObject({
      sessionId: LEAD_2
    })
    await expect(
      leadOf([old, NOW], { open: [LEAD_1, LEAD_2] })({ sessionId: WORKER })
    ).rejects.toThrow(/Plans of different Leads name this chat .*old\.md.*2026-11-28-refunds\.md/)
  })

  it('skips a plan the chat leads itself, and needs a chat or --plan', async () => {
    await expect(leadOf([NOW])({ sessionId: LEAD_2 })).rejects.toThrow(/No plan in HQ\/runs/)
    await expect(leadOf([NOW])({ sessionId: null })).rejects.toThrow(/pass --plan <file>/)
    const bare = plan('bare.md', 'Lead chat: TBD', `| T1 | Refund cap | ${WORKER} |`)
    await expect(leadOf([bare])({ sessionId: WORKER })).rejects.toThrow(/No plan in HQ\/runs/)
    await expect(leadOf([bare])({ sessionId: null, plan: 'bare' })).rejects.toThrow(
      /names no chat Orca\+ knows/
    )
  })
})

describe('hqReadPlanTexts', () => {
  let dir: string | null = null
  afterEach(async () => {
    if (dir) {
      await rm(dir, { recursive: true, force: true })
      dir = null
    }
  })

  it('reads the plans at the top of HQ/runs, newest first, and no task files', async () => {
    dir = await mkdtemp(join(tmpdir(), 'hq-lead-of-'))
    await mkdir(join(dir, 'runs', 'refunds'), { recursive: true })
    await writeFile(join(dir, 'runs', 'old.md'), 'Lead chat: a')
    await writeFile(join(dir, 'runs', 'new.md'), 'Lead chat: b')
    await writeFile(join(dir, 'runs', 'refunds', 'T1.md'), 'Lead chat: c')
    await utimes(join(dir, 'runs', 'old.md'), 1, 1)
    await utimes(join(dir, 'runs', 'new.md'), 2, 2)
    expect((await hqReadPlanTexts(dir)).map((one) => one.file)).toEqual(['new.md', 'old.md'])
  })
})

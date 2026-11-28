// Custom build (hq-task-progress, C7): a chat's work event adds a «Ход» line to its row file, never to the plan.
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { PulseDb } from '../orca-plus/pulse/pulse-db'
import { createHqTaskProgress, hqInsertProgressLine, hqTaskProgressLine } from './hq-task-progress'

const PLAN = '2026-11-28-orca-ai-ux'
const W1 = '22222222-2222-4222-8222-222222222222'
const W2 = '33333333-3333-4333-8333-333333333333'
const AT = new Date(2026, 10, 28, 14, 5).getTime()

const dirs: string[] = []
const dbs: PulseDb[] = []
afterEach(async () => {
  for (const db of dbs.splice(0)) {
    db.close()
  }
  for (const dir of dirs.splice(0)) {
    await rm(dir, { recursive: true, force: true })
  }
})

async function setup(options: { enabled?: boolean; hq?: boolean } = {}) {
  const hq = await mkdtemp(join(tmpdir(), 'hq-progress-'))
  dirs.push(hq)
  await mkdir(join(hq, 'runs', PLAN), { recursive: true })
  const planText = `# plan\n| C7 | row |\n`
  await writeFile(join(hq, 'runs', `${PLAN}.md`), planText)
  const db = new PulseDb(':memory:')
  dbs.push(db)
  db.chats.setTaskLock({ plan: PLAN, row: 'C7', sessionId: W1, at: 1 })
  const progress = createHqTaskProgress({
    enabled: () => options.enabled !== false,
    hqPath: () => (options.hq === false ? null : hq),
    rowsOf: (ids) => db.chats.taskRowsOf(ids),
    liveSessionOf: (id) => (id === W2 ? W1 : id),
    now: () => AT
  })
  const file = join(hq, 'runs', PLAN, 'C7.md')
  return { hq, db, progress, file, planText }
}

describe('hqTaskProgressLine', () => {
  it('names the event, the time and the link on one line', () => {
    expect(hqTaskProgressLine('merged', AT, 'https://x/pull/7', 'squash\nabc')).toBe(
      '- 14:05 PR влит · https://x/pull/7 · squash abc'
    )
    expect(hqTaskProgressLine('opened', AT)).toBe('- 14:05 PR открыт')
    expect(hqTaskProgressLine('shipped', AT)).toBe('- 14:05 выкачено')
  })
})

describe('hqInsertProgressLine', () => {
  it('adds the heading to a file that has none, and creates text from nothing', () => {
    expect(hqInsertProgressLine('', '- 14:05 PR влит')).toBe('## Ход\n- 14:05 PR влит\n')
    expect(hqInsertProgressLine('# C7\n', '- 14:05 PR влит')).toBe(
      '# C7\n\n## Ход\n- 14:05 PR влит\n'
    )
  })
  it('puts the line last in «Ход», before the next section', () => {
    const text = '# C7\n\n## Ход\n- 13:00 старт\n\n## Откат\n- revert\n'
    expect(hqInsertProgressLine(text, '- 14:05 PR влит')).toBe(
      '# C7\n\n## Ход\n- 13:00 старт\n- 14:05 PR влит\n\n## Откат\n- revert\n'
    )
  })
  it('adds nothing for the same event and link, whatever the time', () => {
    expect(hqInsertProgressLine('## Ход\n- 13:00 PR влит · u\n', '- 14:05 PR влит · u')).toBeNull()
    expect(
      hqInsertProgressLine('## Ход\n- 13:00 PR влит · u\n', '- 14:05 PR влит · v')
    ).not.toBeNull()
  })
})

describe('hq task progress', () => {
  it('appends the event to the row file of the chat holding the row; the plan stays as it was', async () => {
    const t = await setup()
    await writeFile(t.file, '# C7\n\n## Ход\n- 13:00 старт\n')
    const result = await t.progress.record({
      callerSessionId: W1,
      event: 'opened',
      link: 'https://github.com/acme/api/pull/9'
    })
    expect(result).toMatchObject({ ok: true, rows: [{ plan: PLAN, row: 'C7', status: 'written' }] })
    expect(await readFile(t.file, 'utf8')).toBe(
      '# C7\n\n## Ход\n- 13:00 старт\n- 14:05 PR открыт · https://github.com/acme/api/pull/9\n'
    )
    expect(await readFile(join(t.hq, 'runs', `${PLAN}.md`), 'utf8')).toBe(t.planText)
    expect(await readdir(join(t.hq, 'runs'))).toEqual([PLAN, `${PLAN}.md`])
  })
  it('creates the row file when the chat has not, and does not repeat an event', async () => {
    const t = await setup()
    await t.progress.record({ callerSessionId: W1, event: 'merged', link: 'u' })
    const again = await t.progress.record({ callerSessionId: W1, event: 'merged', link: 'u' })
    expect(again).toMatchObject({ ok: true, rows: [{ status: 'duplicate' }] })
    expect(await readFile(t.file, 'utf8')).toBe('## Ход\n- 14:05 PR влит · u\n')
  })
  it('follows a handoff: the parked chat 1 reports into the row its chat 2 holds', async () => {
    const t = await setup()
    t.db.chats.setTaskLock({ plan: PLAN, row: 'C7', sessionId: W1, at: 2 })
    const result = await t.progress.record({ callerSessionId: W2, event: 'shipped' })
    expect(result).toMatchObject({ ok: true, rows: [{ row: 'C7' }] })
  })
  it('reports into the newest row only, and never writes a path from an unsafe name', async () => {
    const t = await setup()
    t.db.chats.setTaskLock({ plan: PLAN, row: 'C8', sessionId: W1, at: 5 })
    const result = await t.progress.record({ callerSessionId: W1, event: 'merged' })
    expect(result).toMatchObject({ rows: [{ row: 'C8' }] })
    await expect(readFile(t.file, 'utf8')).rejects.toThrow()
    t.db.chats.setTaskLock({ plan: '../evil', row: 'X', sessionId: W1, at: 9 })
    const bad = await t.progress.record({ callerSessionId: W1, event: 'merged' })
    expect(bad).toMatchObject({ ok: true, rows: [{ status: 'skipped' }] })
  })
  it('writes nothing for a chat without a row, with the setting off, or without HQ', async () => {
    const t = await setup()
    expect(await t.progress.record({ callerSessionId: 'other', event: 'merged' })).toEqual({
      event: 'merged',
      ok: false,
      reason: 'no-row'
    })
    const off = await setup({ enabled: false })
    expect(await off.progress.record({ callerSessionId: W1, event: 'merged' })).toMatchObject({
      reason: 'off'
    })
    const none = await setup({ hq: false })
    expect(await none.progress.record({ callerSessionId: W1, event: 'merged' })).toMatchObject({
      reason: 'no-hq'
    })
    await expect(readFile(off.file, 'utf8')).rejects.toThrow()
  })
})

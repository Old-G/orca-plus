import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { parseHqSlackScoutTaskTarget } from '../../shared/hq-slack-scout'
import {
  answerHqSlackScoutDraft,
  createHqSlackScoutTask,
  editHqSlackScoutDraft,
  onHqSlackScoutChanged,
  readHqSlackScout,
  rejectHqSlackScoutDraft,
  restoreHqSlackScoutDraft,
  type HqSlackScoutDeps
} from './hq-slack-scout'

let hq: string

function scoutFile(name: string, text: string): void {
  mkdirSync(join(hq, 'slack-scout'), { recursive: true })
  writeFileSync(join(hq, 'slack-scout', name), text)
}

const draft = (id: string, title = 'Fix the cart') => ({
  id,
  channelName: 'lh-bugs',
  author: 'Laure',
  permalink: 'https://slack/p',
  quote: 'cart is broken',
  title,
  description: '## Зачем'
})

function deps(createTask: HqSlackScoutDeps['createTask']): HqSlackScoutDeps {
  return { createTask, now: () => 42 }
}

beforeEach(() => {
  hq = mkdtempSync(join(tmpdir(), 'hq-slack-scout-'))
})

afterEach(() => {
  rmSync(hq, { recursive: true, force: true })
})

describe('HQ Slack scout files', () => {
  it('reads nothing pending, and says unconfigured, before the scout ever ran', async () => {
    await expect(readHqSlackScout(hq)).resolves.toEqual({
      ok: true,
      configured: false,
      lastRunAt: null,
      failedAt: null,
      drafts: [],
      done: [],
      quiet: []
    })
  })

  it('hides a request nobody decided for longer than card_ttl_days', async () => {
    const DAY = 24 * 60 * 60_000
    const now = Date.parse('2026-10-17T12:00:00Z')
    scoutFile('config.yaml', 'card_ttl_days: 2\n')
    scoutFile(
      'drafts.json',
      JSON.stringify({
        drafts: [
          { ...draft('D1:1'), foundAt: new Date(now - DAY).toISOString() },
          { ...draft('D1:2'), foundAt: new Date(now - 3 * DAY).toISOString() }
        ]
      })
    )
    const result = await readHqSlackScout(hq, () => now)
    expect(result.ok ? result.drafts.map((entry) => entry.id) : []).toEqual(['D1:1'])
  })

  it("lets only clickup.json name a ClickUp task, never the scout's drafts.json", async () => {
    scoutFile(
      'drafts.json',
      JSON.stringify({
        drafts: [{ ...draft('D1:1'), source: 'clickup', clickupTaskId: 'victim', foundAt: 'x' }]
      })
    )
    scoutFile(
      'clickup.json',
      JSON.stringify({
        lastCheckAt: 1,
        drafts: [
          { ...draft('clickup:t1:c1'), clickupTaskId: 't1', foundAt: 'x' },
          { ...draft('clickup:none:c2'), source: 'clickup', foundAt: 'x' }
        ]
      })
    )
    const result = await readHqSlackScout(hq)
    const drafts = result.ok ? result.drafts : []
    expect(drafts.map((entry) => [entry.id, entry.source, entry.clickupTaskId])).toEqual([
      ['D1:1', undefined, undefined],
      ['clickup:t1:c1', 'clickup', 't1']
    ])
  })

  it('reports a failed last run from the status run.sh writes, and clears it after a good one', async () => {
    scoutFile('status.json', JSON.stringify({ at: '2026-10-06T17:07:38Z', ok: false, exitCode: 2 }))
    await expect(readHqSlackScout(hq)).resolves.toMatchObject({ failedAt: '2026-10-06T17:07:38Z' })
    scoutFile('status.json', JSON.stringify({ at: '2026-10-06T17:30:20Z', ok: true, exitCode: 0 }))
    await expect(readHqSlackScout(hq)).resolves.toMatchObject({ failedAt: null })
    scoutFile('status.json', 'not json')
    await expect(readHqSlackScout(hq)).resolves.toMatchObject({ ok: true, failedAt: null })
  })

  it('lists undecided drafts and drops a malformed one alone', async () => {
    scoutFile('config.yaml', 'list_id: 901520612528\n')
    scoutFile(
      'drafts.json',
      JSON.stringify({ lastRunAt: 't1', drafts: [draft('C1:1'), { id: 'C1:2' }, draft('C1:3')] })
    )
    scoutFile('decisions.json', JSON.stringify({ 'C1:3': { decision: 'rejected', at: 1 } }))
    const result = await readHqSlackScout(hq)
    expect(result).toMatchObject({ ok: true, configured: true, lastRunAt: 't1' })
    expect(result.ok && result.drafts.map((entry) => entry.id)).toEqual(['C1:1'])
  })

  it('remembers a rejection so the draft never comes back', async () => {
    scoutFile('drafts.json', JSON.stringify({ drafts: [draft('C1:1'), draft('C1:2')] }))
    await Promise.all([rejectHqSlackScoutDraft(hq, 'C1:1'), rejectHqSlackScoutDraft(hq, 'C1:2')])
    const decisions = JSON.parse(readFileSync(join(hq, 'slack-scout', 'decisions.json'), 'utf8'))
    expect(Object.keys(decisions).sort()).toEqual(['C1:1', 'C1:2'])
    const result = await readHqSlackScout(hq)
    expect(result.ok && result.drafts).toEqual([])
  })

  it('creates the edited draft where config.yaml says and records the task link', async () => {
    scoutFile(
      'config.yaml',
      '# where tasks go\nlist_id: "901520612528"\nassignee_id: 100539875 # Gleb\nstatus: future\n'
    )
    const createTask = vi.fn(async () => ({
      ok: true as const,
      url: 'https://app.clickup.com/t/x'
    }))
    await expect(
      createHqSlackScoutTask(
        hq,
        { id: 'C1:1', title: 'Edited', description: 'Body' },
        deps(createTask)
      )
    ).resolves.toEqual({ ok: true, taskUrl: 'https://app.clickup.com/t/x' })
    expect(createTask).toHaveBeenCalledWith({
      listId: '901520612528',
      name: 'Edited',
      markdownDescription: 'Body',
      assigneeId: '100539875',
      status: 'future'
    })
    const decisions = JSON.parse(readFileSync(join(hq, 'slack-scout', 'decisions.json'), 'utf8'))
    expect(decisions['C1:1']).toEqual({
      decision: 'created',
      at: 42,
      taskUrl: 'https://app.clickup.com/t/x'
    })
  })

  it('creates nothing without a list in config.yaml, and records nothing when ClickUp refuses', async () => {
    const createTask = vi.fn(async () => ({ ok: false as const, error: 'denied' }))
    await expect(
      createHqSlackScoutTask(hq, { id: 'C1:1', title: 'T', description: '' }, deps(createTask))
    ).resolves.toMatchObject({ ok: false })
    expect(createTask).not.toHaveBeenCalled()
    scoutFile('config.yaml', 'list_id: 9015\n')
    await expect(
      createHqSlackScoutTask(hq, { id: 'C1:1', title: 'T', description: '' }, deps(createTask))
    ).resolves.toEqual({ ok: false, error: 'denied' })
    expect(() => readFileSync(join(hq, 'slack-scout', 'decisions.json'))).toThrow()
  })

  it('takes only a numeric list and assignee from config.yaml', () => {
    expect(parseHqSlackScoutTaskTarget('list_id: abc\n')).toBeNull()
    expect(parseHqSlackScoutTaskTarget('list_id: 12\nassignee_id: me\n')).toEqual({
      listId: '12',
      assigneeId: null,
      status: null
    })
  })

  it('reads the kind, ask and project of a request, and drops a bad field alone', async () => {
    scoutFile(
      'drafts.json',
      JSON.stringify({
        drafts: [
          { ...draft('C1:1'), kind: 'answer', ask: 'проверь тикеты', project: 'flowbridge' },
          { ...draft('C1:2'), kind: 'later', project: 42 }
        ]
      })
    )
    const result = await readHqSlackScout(hq)
    expect(result.ok && result.drafts).toMatchObject([
      { id: 'C1:1', kind: 'answer', ask: 'проверь тикеты', project: 'flowbridge' },
      { id: 'C1:2', kind: undefined, project: undefined }
    ])
  })

  it('lays the owner corrections over the scout draft, merging later ones', async () => {
    scoutFile('drafts.json', JSON.stringify({ drafts: [{ ...draft('C1:1'), kind: 'do' }] }))
    await editHqSlackScoutDraft(hq, 'C1:1', { kind: 'answer', project: null })
    await editHqSlackScoutDraft(hq, 'C1:1', { ask: 'ответить Ирине' })
    const result = await readHqSlackScout(hq)
    expect(result.ok && result.drafts[0]).toMatchObject({
      kind: 'answer',
      project: null,
      ask: 'ответить Ирине',
      title: 'Fix the cart'
    })
    // The scout's own file stays as it wrote it.
    const drafts = JSON.parse(readFileSync(join(hq, 'slack-scout', 'drafts.json'), 'utf8'))
    expect(drafts.drafts[0].kind).toBe('do')
  })

  it('Just reply closes the request without a task, and tells listeners', async () => {
    scoutFile('drafts.json', JSON.stringify({ drafts: [draft('C1:1')] }))
    const listener = vi.fn()
    const off = onHqSlackScoutChanged(listener)
    await answerHqSlackScoutDraft(hq, 'C1:1', deps(vi.fn()))
    off()
    expect(listener).toHaveBeenCalledTimes(1)
    const decisions = JSON.parse(readFileSync(join(hq, 'slack-scout', 'decisions.json'), 'utf8'))
    // Why: the journal names the request after its draft is gone.
    expect(decisions['C1:1']).toEqual({
      decision: 'answered',
      at: 42,
      title: 'Fix the cart',
      author: 'Laure',
      source: 'slack',
      permalink: 'https://slack/p'
    })
    const result = await readHqSlackScout(hq, () => 43)
    expect(result.ok && result.drafts).toEqual([])
    expect(result.ok && result.done).toEqual([{ ...decisions['C1:1'], id: 'C1:1' }])
  })

  it('brings a skipped request back while its draft is on file, and only a skipped one', async () => {
    scoutFile('drafts.json', JSON.stringify({ drafts: [draft('C1:1'), draft('C1:2')] }))
    await rejectHqSlackScoutDraft(hq, 'C1:1', deps(vi.fn()))
    await answerHqSlackScoutDraft(hq, 'C1:2', deps(vi.fn()))
    await restoreHqSlackScoutDraft(hq, 'C1:1')
    await expect(restoreHqSlackScoutDraft(hq, 'C1:2')).rejects.toThrow('can no longer come back')
    const result = await readHqSlackScout(hq)
    expect(result.ok && result.drafts.map((entry) => entry.id)).toEqual(['C1:1'])
  })

  it("drops last week's decisions from the journal once they are older", async () => {
    scoutFile(
      'decisions.json',
      JSON.stringify({
        old: { decision: 'rejected', at: 1 },
        fresh: {
          decision: 'created',
          at: 8 * 24 * 3_600_000,
          taskUrl: 'https://app.clickup.com/t/1'
        }
      })
    )
    const result = await readHqSlackScout(hq, () => 8 * 24 * 3_600_000 + 1)
    expect(result.ok && result.done?.map((entry) => entry.id)).toEqual(['fresh'])
  })

  it('keeps the decisions it understands when one entry is from a newer app', async () => {
    scoutFile('drafts.json', JSON.stringify({ drafts: [draft('C1:1'), draft('C1:2')] }))
    scoutFile(
      'decisions.json',
      JSON.stringify({
        'C1:1': { decision: 'delegated', at: 1 },
        'C1:2': { decision: 'rejected', at: 1 }
      })
    )
    const result = await readHqSlackScout(hq)
    expect(result.ok && result.drafts.map((entry) => entry.id)).toEqual(['C1:1'])
  })
})

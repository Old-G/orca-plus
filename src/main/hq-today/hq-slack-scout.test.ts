import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { parseHqSlackScoutTaskTarget } from '../../shared/hq-slack-scout'
import {
  createHqSlackScoutTask,
  readHqSlackScout,
  rejectHqSlackScoutDraft,
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
      drafts: []
    })
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
})

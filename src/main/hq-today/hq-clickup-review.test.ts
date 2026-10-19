import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HqSlackScoutDraft } from '../../shared/hq-slack-scout'
import { readHqSlackScout } from './hq-slack-scout'
import {
  replyHqClickUpReview,
  routeHqClickUpReviews,
  startHqClickUpReview,
  type HqClickUpReviewDeps
} from './hq-clickup-review'

const NOW = Date.parse('2026-10-19T12:00:00Z')

let hq: string

const card = (id: string): HqSlackScoutDraft => ({
  id,
  source: 'clickup',
  clickupTaskId: 't1',
  kind: 'fyi',
  channelName: 'ClickUp · DEV-1',
  author: '',
  permalink: 'https://app.clickup.com/t/t1',
  quote: 'Step 3',
  ask: 'Разобрать: новые шаги',
  title: 'Смена частоты',
  description: '',
  project: 'acme_support_service',
  needsReview: true,
  foundAt: '2026-10-19T11:00:00Z'
})

async function writeCards(cards: HqSlackScoutDraft[], config = ''): Promise<void> {
  await writeFile(join(hq, 'slack-scout', 'clickup-triage.json'), JSON.stringify({ drafts: cards }))
  await writeFile(join(hq, 'slack-scout', 'config.yaml'), config)
}

function deps(
  over: Partial<HqClickUpReviewDeps> = {}
): HqClickUpReviewDeps & { launch: ReturnType<typeof vi.fn>; deliver: ReturnType<typeof vi.fn> } {
  return {
    workspaceFor: async () => ({ worktreeId: 'repo::/p', name: 'acme_support_service' }),
    freePercent: () => 80,
    now: () => NOW,
    ...over,
    launch: vi.fn(async () => ({ ok: true as const, sessionId: 's1', tabId: 'tab-1' })),
    deliver: vi.fn(async () => true)
  }
}

async function shown() {
  const scout = await readHqSlackScout(hq, () => NOW)
  return scout.ok ? scout.drafts : []
}

beforeEach(async () => {
  hq = await mkdtemp(join(tmpdir(), 'hq-review-'))
  await mkdir(join(hq, 'slack-scout'), { recursive: true })
})

afterEach(async () => {
  await rm(hq, { recursive: true, force: true })
})

describe('«Разобрать»', () => {
  it('starts a chat in the task’s project, then shows its draft as the card’s answer', async () => {
    await writeCards([card('c1')])
    const d = deps()
    expect(await startHqClickUpReview(hq, 'c1', d)).toEqual({
      ok: true,
      worktreeId: 'repo::/p',
      tabId: 'tab-1'
    })
    expect(String(d.launch.mock.calls[0]?.[1])).toContain('orca pulse review reply --task t1')
    expect((await shown())[0]?.review?.state).toBe('running')

    // A second click finds the same chat instead of starting another.
    await startHqClickUpReview(hq, 'c1', d)
    expect(d.launch).toHaveBeenCalledOnce()

    expect(
      await replyHqClickUpReview(hq, { taskId: 't1', reply: 'Это to do.' }, () => NOW)
    ).toEqual({ ok: true })
    expect((await shown())[0]).toMatchObject({ kind: 'answer', description: 'Это to do.' })
  })

  it('refuses a draft for a task nobody is looking into', async () => {
    expect(await replyHqClickUpReview(hq, { taskId: 'tX', reply: 'x' }, () => NOW)).toMatchObject({
      ok: false
    })
  })

  it('sends a later change of the task to its open chat', async () => {
    await writeCards([card('c1')])
    const d = deps()
    await startHqClickUpReview(hq, 'c1', d)
    await replyHqClickUpReview(hq, { taskId: 't1', reply: 'old' }, () => NOW)

    await writeCards([card('c2')])
    await routeHqClickUpReviews(hq, [card('c2')], d)
    expect(d.deliver).toHaveBeenCalledWith('s1', expect.stringContaining('новые изменения'))
    expect(d.launch).toHaveBeenCalledOnce()
    const [next] = await shown()
    expect(next).toMatchObject({ id: 'c2', kind: 'fyi', review: { state: 'running' } })
    const file = JSON.parse(await readFile(join(hq, 'slack-scout', 'clickup-reviews.json'), 'utf8'))
    expect(file.t1.reply).toBeUndefined()
  })

  it('autostarts only where config.yaml switched it on', async () => {
    const d = deps()
    await writeCards([card('c1')])
    await routeHqClickUpReviews(hq, [card('c1')], d)
    expect(d.launch).not.toHaveBeenCalled()

    await writeCards([card('c1')], 'clickup_review_autostart: [acme_support_service]\n')
    await routeHqClickUpReviews(hq, [card('c1')], d)
    expect(d.launch).toHaveBeenCalledOnce()
    const file = JSON.parse(await readFile(join(hq, 'slack-scout', 'clickup-reviews.json'), 'utf8'))
    expect(file.t1).toMatchObject({ auto: true, sessionId: 's1', cardId: 'c1' })
  })
})

import { mkdtempSync, mkdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HqJournalInput, HqSession } from '../../shared/hq-journal'
import type { HqSpace } from '../../shared/hq-spaces'
import type { PulsePerson, PulseWaiting } from '../../shared/pulse-types'
import type { HqRoomSources } from '../hq-journal/hq-journal-rooms'
import { createHqContextService } from './hq-context'

const NOW = Date.parse('2026-10-23T12:00:00Z')
const DAY = 86_400_000

let hq: string
let recorded: HqJournalInput[]

const space = (slug: string, projects: string[], repoIds: string[]): HqSpace => ({
  slug,
  name: slug === 'acme' ? 'Acme' : 'Kite club',
  color: '#000000',
  repoIds,
  projects,
  messenger: slug === 'acme' ? 'slack' : null,
  tasks: slug === 'acme' ? 'clickup' : null
})

const waiting = (extra: Partial<PulseWaiting>): PulseWaiting => ({
  id: 'w1',
  direction: 'on-them',
  personId: 'p-bob',
  project: 'acme-billing',
  title: 'Ключи от платёжки',
  detail: null,
  source: 'agent',
  sourceRef: 'DEV-101',
  status: 'open',
  dueAt: null,
  resolution: null,
  createdAt: NOW - 2 * DAY,
  resolvedAt: null,
  agentSessionId: null,
  paneKey: null,
  worktreeId: null,
  reply: null,
  replyAuthor: null,
  replyTs: null,
  repliedAt: null,
  replyDeliveredAt: null,
  ...extra
})

const person = (id: string, name: string): PulsePerson => ({
  id,
  name,
  slackUserId: null,
  clickupUserId: null,
  role: null,
  notes: null,
  createdAt: 0,
  updatedAt: 0
})

function service(sessions: HqSession[] = []) {
  const sources = (): HqRoomSources => ({
    spaces: [space('acme', ['acme-billing'], ['r-bill']), space('kite', ['kite'], ['r-kite'])],
    groupRooms: new Map(),
    projectOfRepo: new Map([
      ['r-bill', 'acme-billing'],
      ['r-kite', 'kite']
    ]),
    defaultRoom: null,
    repos: [
      { id: 'r-bill', path: '/Users/me/acme-billing', displayName: 'Billing' },
      { id: 'r-kite', path: '/Users/me/kite', displayName: 'Kite' },
      { id: 'r-hq', path: hq, displayName: 'HQ' }
    ],
    hqPath: hq,
    folderGroup: () => null,
    sessionWorkspace: () => null
  })
  return createHqContextService({
    enabled: () => true,
    hqPath: () => hq,
    sources: async () => sources(),
    pulse: {
      listWaitings: () => [
        waiting({}),
        waiting({ id: 'w2', direction: 'on-me', personId: 'p-ann', title: 'Ответ по тарифу' }),
        waiting({ id: 'w3', project: 'kite', title: 'Чужая комната' })
      ],
      listDecisions: () => [],
      listSessionsByProject: (project) => sessions.filter((s) => s.project === project),
      list: () => [],
      record: (inputs) => {
        recorded.push(...inputs)
        return { added: inputs.length, settled: 0, moved: 0 }
      },
      listPeople: () => [person('p-bob', 'Bob'), person('p-ann', 'Ann')]
    },
    now: () => NOW
  })
}

const inBilling = { cwd: '/Users/me/acme-billing' }
const inKite = { cwd: '/Users/me/kite' }

beforeEach(() => {
  vi.useFakeTimers({ now: NOW, toFake: ['Date'] })
  recorded = []
  hq = mkdtempSync(join(tmpdir(), 'hq-context-'))
  mkdirSync(join(hq, 'projects'))
  mkdirSync(join(hq, 'plans'))
  mkdirSync(join(hq, 'workspaces', 'acme'), { recursive: true })
  mkdirSync(join(hq, 'wiki'))
  writeFileSync(
    join(hq, 'projects', 'acme-billing.md'),
    '---\nproject: acme-billing\nid: r-bill\npath: /Users/me/acme-billing\nstatus: active\nsynced_at: 2026-09-01T00:00:00Z\n---\n\n# Billing for Acme\n'
  )
  writeFileSync(join(hq, 'projects', 'kite.md'), '---\nproject: kite\nid: r-kite\n---\n# Kite\n')
  writeFileSync(
    join(hq, 'plans', 'acme-billing.md'),
    '## Этап 2\n- [x] **2.1 Карты.**\n- [ ] **2.2 Возвраты.** ▶\n- [ ] **2.3 Отчёт.** ■ ждёт выгрузку от Bob\n'
  )
  writeFileSync(
    join(hq, 'workspaces', 'acme', 'context.md'),
    '# Acme\n- Bob — бухгалтерия, просить в Slack\n'
  )
  writeFileSync(join(hq, 'autonomy.yaml'), 'default: 1\nprojects:\n  acme-billing: 2\n')
})

afterEach(() => {
  vi.useRealTimers()
  rmSync(hq, { recursive: true, force: true })
})

describe('hq context card', () => {
  it('names the step, the blocker and who we wait for, each block with its source; a stale page is marked', async () => {
    const card = await service().context(inBilling)
    const text = card.lines.join('\n')
    expect(card.lines.length).toBeLessThanOrEqual(60)
    expect(text).toContain('комната: Acme · уровень автономии: 2')
    expect(text).toMatch(
      /страница: HQ\/projects\/acme-billing\.md, синхронизирована 52 дн назад · ⚠ устарело/
    )
    expect(text).toContain('▶ 2.2 Возвраты (Этап 2)')
    expect(text).toContain('■ 2.3 Отчёт — ждёт выгрузку от Bob')
    expect(text).toContain(
      '## Кого ждём · orca pulse wait\n- Bob: Ключи от платёжки DEV-101 — с 21.10 (2 дн назад)'
    )
    expect(text).toContain('## Что должны мы · orca pulse wait\n- Ann: Ответ по тарифу')
    expect(text).not.toContain('Чужая комната')
  })

  it('a chat in one room cannot read a project of another room; HQ+ can, and that read is journaled', async () => {
    await expect(service().context(inKite, 'acme-billing')).rejects.toThrow(
      /not in this chat's room/
    )
    const card = await service().context({ cwd: hq }, 'acme-billing')
    expect(card.room).toBe('acme')
    expect(recorded).toEqual([
      expect.objectContaining({ kind: 'cross-read', project: 'acme-billing' })
    ])
  })

  it('stays within 60 lines however much there is', async () => {
    const sessions = Array.from({ length: 40 }, (_, i) => ({
      sessionId: `s${i}`,
      address: `acme-billing/t${i}`,
      agent: 'claude',
      worktreeId: null,
      workspace: 'acme',
      project: 'acme-billing',
      state: 'working' as const,
      contextPct: null,
      openedAt: NOW - 1000,
      lastActivityAt: NOW - 1000,
      closedAt: null,
      parentSessionId: null,
      taskRef: null
    }))
    const card = await service(sessions).context(inBilling)
    expect(card.lines.length).toBeLessThanOrEqual(60)
    expect(card.lines.join('\n')).toContain('…и ещё 34')
  })
})

describe('hq session start', () => {
  it("tells a new chat its room's notes and its project's card; HQ+ gets nothing", async () => {
    const start = await service().sessionStart(inBilling)
    expect(start.text).toContain('- Bob — бухгалтерия, просить в Slack')
    expect(start.text).toContain('▶ 2.2 Возвраты')
    expect(start.text).toContain(
      'В первом ответе одной строкой назови текущий шаг плана и кого ждём'
    )
    expect((await service().sessionStart({ cwd: hq })).text).toBe('')
  })
})

describe('hq step, where, workspace add', () => {
  it('ticks a step in its own room and journals it', async () => {
    utimesSync(join(hq, 'plans', 'acme-billing.md'), new Date(NOW - DAY), new Date(NOW - DAY))
    const result = await service().step(inBilling, { id: '2.2', done: true })
    expect(result).toMatchObject({ changed: true, step: { id: '2.2', done: true } })
    expect(readFileSync(join(hq, 'plans', 'acme-billing.md'), 'utf8')).toContain(
      '- [x] **2.2 Возвраты.**'
    )
    expect(recorded).toEqual([expect.objectContaining({ kind: 'plan.step', workspace: 'acme' })])
    await expect(
      service().step(inKite, { project: 'acme-billing', id: '2.3', done: true })
    ).rejects.toThrow()
  })

  it('finds a plan of another name by its frontmatter', async () => {
    writeFileSync(
      join(hq, 'plans', 'kite-roadmap.md'),
      '---\nproject: kite\n---\n# Kite\n- [ ] **3.1 Крыло.** ▶\n'
    )
    expect((await service().context(inKite)).lines.join('\n')).toContain(
      '## План · HQ/plans/kite-roadmap.md'
    )
    await service().step(inKite, { id: '3.1', done: true })
    expect(readFileSync(join(hq, 'plans', 'kite-roadmap.md'), 'utf8')).toContain('- [x] **3.1')
  })

  it('finds the source for a question by its words', async () => {
    writeFileSync(
      join(hq, 'wiki', 'where.md'),
      '| Вопрос | Где ответ |\n|---|---|\n| Кто кому что должен | `orca pulse wait list` |\n| Что мы решили | `orca pulse decision list` |\n'
    )
    const result = await service().where('кто мне что должен?')
    expect(result.answers[0]).toMatchObject({ where: '`orca pulse wait list`' })
  })

  it('creates a room with a context.md to fill, once', async () => {
    const added = await service().addRoom({
      name: 'Новая Компания',
      color: '#112233',
      tasks: 'jira'
    })
    expect(added.slug).toBe('novaya-kompaniya')
    const yaml = readFileSync(join(hq, 'workspaces', 'novaya-kompaniya', 'workspace.yaml'), 'utf8')
    expect(yaml).toContain('name: Новая Компания')
    expect(
      readFileSync(join(hq, 'workspaces', 'novaya-kompaniya', 'context.md'), 'utf8')
    ).toContain('Задачи: jira')
    await expect(service().addRoom({ name: 'Новая Компания' })).rejects.toThrow(/already exists/)
  })
})

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { agentFinishedBellItem } from '../../shared/pulse-bell'
import {
  structuredAgentSessionPaneKey,
  structuredAgentSessionTabId
} from '../../shared/structured-agent-session-projection'
import { PulseDb } from '../orca-plus/pulse/pulse-db'
import { createHqJournalService, type HqJournalService } from './hq-journal-service'

let hq: string
let db: PulseDb
let service: HqJournalService
let clock: number
let journalOn: boolean

const API_WORKTREE = 'r-api::/Users/me/wt/api'
const KITE_WORKTREE = 'r-kite::/Users/me/Projects/kite'

function reportName(at: Date): string {
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `codex-review-${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}T${pad(at.getHours())}-${pad(at.getMinutes())}.md`
}

async function writeHq(): Promise<void> {
  const file = async (path: string, text: string): Promise<void> => {
    await mkdir(join(hq, path, '..'), { recursive: true })
    await writeFile(join(hq, path), text)
  }
  await file(
    'workspaces/acme/workspace.yaml',
    'name: Acme\ncolor: "#3b82f6"\norder: 1\nprojects: [acme-api]\nmessenger: slack\ntasks: clickup\n'
  )
  await file(
    'workspaces/hobby/workspace.yaml',
    'name: Hobby\ncolor: "#a855f7"\norder: 2\nprojects: [kite]\nmcp:\n  deny: [claude.ai Acme*, acme_crm]\n'
  )
  await file('projects/acme-api.md', '---\nid: r-api\nproject: acme-api\n---\n# Acme API\n')
  await file('projects/kite.md', '---\nid: r-kite\nproject: kite\n---\n# Kite\n')
  await file(
    `updates/${reportName(new Date(Date.now() - 60 * 60_000))}`,
    [
      '# Codex за день',
      '',
      '## acme-api · коммитов: 2',
      '',
      '- **[P1] Retry the refund call once** — `src/refunds.ts:10-12`',
      '  A timeout leaves the refund half done.',
      '',
      '## kite · коммитов: 1',
      '',
      '- **[P2] Name the kite colour constant** — `src/kite.ts:3`',
      '  Magic number.',
      ''
    ].join('\n')
  )
}

function seedPulse(): void {
  const ann = db.upsertPerson({ name: 'Ann' })
  const asked = db.addWaiting({
    direction: 'on-them',
    title: 'Refund limits for March',
    personId: ann.id,
    project: 'acme-api',
    source: 'slack',
    agentSessionId: 'claude_api',
    worktreeId: API_WORKTREE
  })
  db.recordWaitingReply(asked.id, {
    text: 'Up to 200 per order',
    author: 'Ann',
    ts: '1.5',
    link: 'https://acme.slack.com/archives/C1/p15'
  })
  const task = db.addWaiting({
    direction: 'on-them',
    title: 'Review the API spec',
    personId: ann.id,
    project: 'acme-api',
    source: 'clickup'
  })
  db.recordWaitingReply(task.id, {
    text: 'Looks fine, merge it',
    author: 'Ann',
    ts: '2.0',
    link: 'https://app.clickup.com/t/abc?comment=9'
  })
  db.closeWaiting(task.id, 'resolved', 'merged')
  const draft = db.addDraft({
    kind: 'message',
    body: 'Thanks, Ann — merging today.',
    target: '#acme-dev',
    source: 'gate',
    call: {
      agent: 'claude',
      toolName: 'mcp__slack__send_message',
      toolInput: { text: 'Thanks' },
      toolUseId: null,
      sessionId: null,
      cwd: '/Users/me/wt/api',
      paneKey: null,
      agentSessionId: 'claude_api',
      service: 'Slack',
      operation: 'send',
      editField: null
    }
  }).record
  db.decideDraft(draft.id, 'approved')
  const tabId = structuredAgentSessionTabId('claude_kite')
  db.addInboxItem(
    agentFinishedBellItem({
      paneKey: structuredAgentSessionPaneKey(tabId, 'claude_kite'),
      worktreeId: KITE_WORKTREE,
      agentLabel: 'Claude',
      place: 'kite / main',
      sessionTitle: 'Kite colours',
      lastMessage: 'Moved the kite palette into one file and added the missing dark shade.'
    })
  )
}

beforeEach(async () => {
  hq = await mkdtemp(join(tmpdir(), 'orca-hq-journal-'))
  await writeHq()
  db = new PulseDb(':memory:')
  seedPulse()
  clock = Date.now()
  journalOn = true
  service = createHqJournalService({
    enabled: () => journalOn,
    hqPath: () => hq,
    repos: () => [
      { id: 'r-api', path: '/Users/me/Projects/acme-api', displayName: 'Acme API' },
      { id: 'r-kite', path: '/Users/me/Projects/kite', displayName: 'Kite' },
      { id: 'r-hq', path: hq, displayName: 'HQ' }
    ],
    folderGroup: () => null,
    sessionWorkspace: (id) =>
      ({ claude_api: API_WORKTREE, claude_kite: KITE_WORKTREE, claude_hq: `r-hq::${hq}` })[id] ??
      null,
    pulse: {
      listWaitings: () => db.listWaitings(),
      listDrafts: () => db.listDrafts(),
      listDecisions: (limit) => db.listDecisions({ limit }),
      listFinishedChats: (since) =>
        db.listInbox({ includeDone: true, kind: 'agent-finished', since }),
      listBell: (since) => db.listInbox({ includeDone: true, since }),
      listPeople: () => db.listPeople(),
      record: (inputs) => db.recordJournal(inputs),
      noteSessions: (inputs) => db.noteSessions(inputs),
      getSession: (id) => db.getSession(id),
      list: (query) => db.listJournal(query)
    },
    now: () => clock,
    log: () => {}
  })
})

afterEach(async () => {
  service.dispose()
  db.close()
  await rm(hq, { recursive: true, force: true })
})

describe('HQ+ journal', () => {
  it('turns every source into journal rows once, and HQ+ sees their headings', async () => {
    const first = await service.sync()
    expect(first.added).toBeGreaterThan(0)
    expect(await service.sync()).toEqual({ added: 0, settled: 0, moved: 0 })

    const overview = await service.events({ sessionId: 'claude_hq' })
    if (overview.scope !== 'overview') {
      throw new Error('expected the overview')
    }
    const kinds = overview.headers.map((entry) => `${entry.workspace} ${entry.kind}`)
    expect(kinds).toEqual(
      expect.arrayContaining([
        'acme waiting.open',
        'acme waiting.done',
        'acme person.reply',
        'acme approve.request',
        'acme approve.result',
        'acme review.finding',
        'hobby chat.report',
        'hobby review.finding'
      ])
    )
    expect(overview.headers.some((entry) => Reflect.has(entry, 'body'))).toBe(false)
    const replies = db.listJournal({ kind: 'person.reply' })
    // Why: both answers carry the same moment; their order between them means nothing.
    expect(
      replies
        .map((entry) => [entry.source, entry.needs, entry.status])
        .sort((a, b) => String(a[0]).localeCompare(String(b[0])))
    ).toEqual([
      ['clickup-poller', 'owner:decide', 'done'],
      ['slack-reader', 'agent:claude_api', 'open']
    ])
    expect(db.getSession('claude_kite')).toMatchObject({ workspace: 'hobby', project: 'kite' })
    const agentsMove = await service.events({ sessionId: 'claude_hq', needs: 'agent' })
    expect(
      agentsMove.scope === 'overview' && agentsMove.headers.map((entry) => entry.kind)
    ).toEqual(['person.reply', 'review.finding'])
  })

  it("logs the owner's own choices for the trust ladder, and not cards that closed by themselves", async () => {
    const skipped = db.addInboxItem({ kind: 'hq-intake', title: 'Ann: look at the export' })
    db.markInboxDone(skipped.record.id, 'skipped')
    const gone = db.addInboxItem({ kind: 'slack-request', title: 'Bob: synced away' })
    db.markInboxDone(gone.record.id, 'gone')
    await service.sync()
    const sources = db.listJournal({ kind: 'owner.decision' }).map((entry) => entry.source)
    expect(sources).toContain('owner:bell:hq-intake:rejected')
    expect(sources.some((source) => source?.startsWith('owner:bell:slack-request'))).toBe(false)
    expect(
      sources.some((source) => /^owner:[a-z-]+:(accepted|edited|rejected)$/.test(source ?? ''))
    ).toBe(true)
  })

  it("never shows a chat another room's entries", async () => {
    await service.sync()
    const kite = await service.events({ sessionId: 'claude_kite', cwd: hq })
    if (kite.scope !== 'room') {
      throw new Error('expected a room')
    }
    expect(kite.room).toBe('hobby')
    expect(kite.entries.length).toBeGreaterThan(0)
    expect(kite.entries.every((entry) => entry.workspace === 'hobby')).toBe(true)
    expect(JSON.stringify(kite.entries)).not.toMatch(/Ann|acme|refund/i)
    await expect(service.events({ sessionId: 'claude_kite', room: 'acme' })).rejects.toThrow(
      /only HQ\+/
    )
  })

  it('lets HQ+ read one room in full and records that it did', async () => {
    await service.sync()
    const acme = await service.events({ sessionId: 'claude_hq', room: 'acme', kind: 'review.*' })
    expect(acme).toMatchObject({ scope: 'room', room: 'acme', roomName: 'Acme' })
    if (acme.scope === 'room') {
      expect(acme.entries.map((entry) => [entry.title, entry.needs])).toEqual([
        ['[P1] Retry the refund call once', 'agent:new']
      ])
      expect(acme.entries[0].body).toContain('src/refunds.ts:10-12')
    }
    expect(db.listJournal({ kind: 'cross-read' })).toMatchObject([
      { workspace: '_all', title: 'HQ+ read room acme', sessionId: 'claude_hq' }
    ])
  })

  it('keeps every row in its room while a workspace file cannot be read', async () => {
    await service.sync()
    const before = db.listJournal({ workspaces: ['acme'], limit: 500 }).length
    await writeFile(join(hq, 'workspaces/acme/workspace.yaml'), 'name: [unclosed\n')
    clock += 2 * 60_000
    expect(await service.sync()).toEqual({ added: 0, settled: 0, moved: 0 })
    expect(db.listJournal({ workspaces: ['acme'], limit: 500 })).toHaveLength(before)
    const kite = await service.events({ sessionId: 'claude_kite' })
    expect(kite.scope === 'room' && kite.entries.every((e) => e.workspace === 'hobby')).toBe(true)
  })

  it('adds no second row for a turn the chat reported itself', async () => {
    db.recordJournal([
      {
        workspace: 'hobby',
        kind: 'chat.report',
        at: Date.now(),
        project: 'kite',
        address: 'kite/kite-colours',
        sessionId: 'claude_kite',
        personId: null,
        title: 'Palette in one file',
        needs: 'nobody',
        status: 'done',
        replyTo: null,
        refKind: 'session',
        refId: 'claude_kite',
        source: 'chat-report',
        dedupeKey: 'chat-report:claude_kite:1'
      }
    ])
    await service.sync()
    expect(db.listJournal({ kind: 'chat.report' }).map((entry) => entry.source)).toEqual([
      'chat-report'
    ])
  })

  it('writes nothing while the owner has the journal off', async () => {
    journalOn = false
    expect(await service.sync()).toEqual({ added: 0, settled: 0, moved: 0 })
    expect(db.listJournal()).toEqual([])
  })

  it('tells a chat where it works', async () => {
    await service.sync()
    expect(await service.whoami({ sessionId: 'claude_kite' })).toMatchObject({
      overview: false,
      room: 'hobby',
      roomName: 'Hobby',
      project: 'kite',
      mcpHidden: ['claude_ai_Acme*', 'acme_crm']
    })
    expect((await service.space({ sessionId: 'claude_kite' })).space?.mcpDeny).toEqual([
      'claude.ai Acme*',
      'acme_crm'
    ])
    const hq = await service.whoami({ sessionId: 'claude_hq' })
    expect(hq.overview).toBe(true)
    expect(hq.mcpHidden).toEqual([])
    expect((await service.space({ sessionId: 'claude_hq' })).space).toBeNull()
  })
})

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { HqBrainResult, HqBrainRow } from '../../../../../shared/hq-brain'
import type { HqPlusBrainState } from './use-hq-plus-brain'
import {
  hqBrainDayLabel,
  hqBrainRowTitle,
  hqBrainSourceLabel,
  hqBrainStatusTag
} from './hq-plus-brain-view'

let state: HqPlusBrainState = { status: 'idle' }
vi.mock('./use-hq-plus-brain', () => ({ useHqPlusBrain: () => state }))
vi.mock('./HqPlusText', () => ({
  HqPlusText: ({ text }: { text: string }) => <span>{text}</span>
}))

const { HqPlusBrain } = await import('./HqPlusBrain')

function row(partial: Partial<HqBrainRow> & { key: string; ts: string }): HqBrainRow {
  return {
    day: partial.ts.slice(0, 10),
    source: 'orca-chat',
    project: 'acme',
    title: null,
    link: null,
    atom: null,
    mentions: 1,
    text: '',
    id: `${partial.key}@${partial.ts.slice(0, 10)}`,
    at: Date.parse(partial.ts),
    group: 'chat',
    status: null,
    person: null,
    target: null,
    chat: null,
    command: false,
    ...partial
  }
}

const RESULT: HqBrainResult = {
  query: 'DEV-123',
  mode: 'timeline',
  matchedBy: 'id',
  ms: 370,
  head: { kind: 'task', title: 'T3 · Prod data for the agent', link: null, project: 'acme' },
  rows: [
    row({
      key: 'decisions:cmd',
      ts: '2026-10-29T21:47:00+03:00',
      source: 'pulse:decisions',
      group: 'sent',
      title: 'remote · delete on a server — DEV-123 — approved',
      status: { kind: 'sent', outcome: 'approved' },
      text: 'ssh host rm -rf /tmp/x',
      command: true
    }),
    row({
      key: 'decisions:dm',
      ts: '2026-10-27T20:08:00+03:00',
      source: 'pulse:decisions',
      group: 'sent',
      title: 'Slack · send message — DEV-123 — approved',
      status: { kind: 'sent', outcome: 'approved' },
      target: 'DM with Ann',
      person: 'Ann',
      text: 'Ann, stage 1 is done'
    }),
    row({
      key: 'claude_aa',
      ts: '2026-10-27T16:45:00+03:00',
      atom: 'fact',
      text: 'Ann put the module on prod.',
      link: 'orca-session:claude_aa',
      chat: { sessionId: 'claude_aa', worktreeId: 'repo::/acme' }
    })
  ],
  waiting: [
    {
      id: 'w1',
      title: 'DEV-123: the token',
      person: 'Bob',
      direction: 'on-them',
      since: 0,
      link: null,
      chat: null
    }
  ],
  closedWaits: 2,
  people: [
    { name: 'Ann', count: 3 },
    { name: 'Bob', count: 1 }
  ]
}

const ACTIONS = { openChat: vi.fn(), openLink: vi.fn(), openFile: vi.fn() }

function render(): string {
  return renderToStaticMarkup(
    <HqPlusBrain
      query="DEV-123"
      backLabel="Feed"
      onQuery={vi.fn()}
      onBack={vi.fn()}
      actions={ACTIONS}
      now={Date.parse('2026-11-05T12:00:00+03:00')}
      focusSearch={0}
    />
  )
}

describe('HqPlusBrain', () => {
  it('shows the entity, Waiting and People, the chips and the rows by day', () => {
    state = { status: 'ready', query: 'DEV-123', result: RESULT }
    const html = render()
    expect(html).toContain('T3 · Prod data for the agent')
    expect(html).toContain('ClickUp task · acme')
    expect(html).toContain('DEV-123: the token')
    expect(html).toContain('Bob')
    expect(html).toContain('27 October')
    expect(html).toContain('Slack · DM with Ann')
    expect(html).toContain('Chat · acme · atom fact')
    // One row was said in a chat: one «Open chat».
    expect(html.match(/Open chat →/g)).toHaveLength(1)
  })

  it('hides command approvals by default and offers to show them', () => {
    state = { status: 'ready', query: 'DEV-123', result: RESULT }
    const html = render()
    expect(html).not.toContain('rm -rf')
    expect(html).toContain('Show 1 command approvals')
    expect(html).toContain('Shown 2 of 2')
    // «All» counts the two rows on view.
    expect(html).toMatch(/All<span>2<\/span>/)
  })

  it('says the brain failed in its own words', () => {
    state = { status: 'error', query: 'DEV-123', message: 'HQ has no brain script' }
    expect(render()).toContain('HQ has no brain script')
  })
})

describe('row words', () => {
  it('names a wait by its person and its state', () => {
    const wait = row({
      key: 'waitings:w',
      ts: '2026-10-27T20:08:00+03:00',
      source: 'pulse:waitings',
      group: 'wait',
      person: 'Ann',
      status: { kind: 'wait', status: 'cancelled', resolution: 'duplicate of DEV-9' }
    })
    expect(hqBrainSourceLabel(wait)).toBe('Waiting · Ann')
    expect(hqBrainStatusTag(wait.status)).toEqual({ text: 'cancelled', tone: 'no' })
    expect(hqBrainStatusTag({ kind: 'sent', outcome: 'rejected' })).toEqual({
      text: 'rejected',
      tone: 'no'
    })
  })

  it('gives a task its own title line and a chat none', () => {
    const task = row({
      key: 'clickup:DEV-1',
      ts: '2026-10-27T13:00:00+03:00',
      source: 'clickup',
      group: 'clickup',
      title: 'DEV-1 Prod data',
      text: 'the description'
    })
    expect(hqBrainRowTitle(task)).toBe('DEV-1 Prod data')
    expect(hqBrainRowTitle({ ...task, group: 'chat', source: 'orca-chat' })).toBeNull()
  })

  it('says today and yesterday, and the date otherwise', () => {
    const now = Date.parse('2026-11-05T12:00:00')
    expect(hqBrainDayLabel('2026-11-05', now)).toBe('Today')
    expect(hqBrainDayLabel('2026-11-04', now)).toBe('Yesterday')
    expect(hqBrainDayLabel('2026-10-29', now)).toBe('29 October')
    expect(hqBrainDayLabel('2025-10-29', now)).toBe('29 October 2025')
  })
})

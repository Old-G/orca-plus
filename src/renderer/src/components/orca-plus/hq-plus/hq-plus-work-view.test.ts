import { describe, expect, it } from 'vitest'
import type { HqChatLinksResult } from '../../../../../shared/hq-chat-links'
import type { HqLiveSession } from '../../../../../shared/hq-sessions'
import { structuredAgentSessionTabId } from '../../../../../shared/agent-session/view/structured-agent-session-projection'
import type { Tab } from '../../../../../shared/tab-types'
import type { HqChatItem } from '../hq/hq-chat-list'
import { hqPlusChatTree } from './hq-plus-chat-tree'
import {
  HQ_PLUS_WORK_CLOSED_HEADING,
  hqPlusFirstLine,
  hqPlusMrOf,
  hqPlusWorkView
} from './hq-plus-work-view'

const chat = (
  sessionId: string,
  group: HqChatItem['group'],
  at: number,
  project = 'acme'
): HqChatItem => {
  const tab: Tab = {
    id: structuredAgentSessionTabId(sessionId),
    entityId: sessionId,
    groupId: 'group-1',
    worktreeId: `wt-${project}`,
    contentType: 'agent-session',
    agentSessionAgent: 'claude',
    label: sessionId,
    customLabel: null,
    color: null,
    sortOrder: 0,
    createdAt: at
  }
  return {
    kind: 'chat',
    tab,
    key: sessionId,
    group,
    displayState: 'idle',
    agentType: 'claude',
    card: null,
    repoId: `repo-${project}`,
    worktreeId: `wt-${project}`,
    projectName: project,
    worktreeName: 'main',
    hostKind: 'local',
    sortAt: at
  } as HqChatItem
}

const links = (spawned: [child: string, parent: string][]): HqChatLinksResult => ({
  links: spawned.map(([sessionId, parentSessionId], index) => ({
    sessionId,
    parentSessionId,
    via: 'launch',
    at: index + 1
  })),
  continues: []
})

const session = (sessionId: string, at: number, tabOpen = false): HqLiveSession => ({
  sessionId,
  address: null,
  project: 'acme',
  workspace: 'room',
  worktreeId: null,
  name: sessionId,
  state: tabOpen ? 'done' : 'closed',
  midTurn: false,
  lastActivityAt: at,
  contextPct: null,
  ownerAt: null,
  onScreen: false,
  tabOpen
})

const DAY = 1_000

describe('HQ+ «Work» view', () => {
  const items = [
    chat('lead', 'done', 10, 'orca'),
    chat('brain', 'needs', 20, 'brain'),
    chat('brain-api', 'working', 30, 'api'),
    chat('agents', 'working', 40, 'agents'),
    chat('support', 'working', 50, 'support'),
    chat('support-sync', 'needs', 60, 'support'),
    chat('alone', 'needs', 70, 'orca'),
    chat('orphan', 'working', 80, 'hub'),
    chat('orphan-2', 'done', 90, 'hub')
  ]
  const facts = links([
    ['brain', 'lead'],
    ['brain-api', 'brain'],
    ['agents', 'lead'],
    ['support-sync', 'support'],
    ['orphan', 'closed-lead'],
    ['orphan-2', 'closed-lead']
  ])
  const view = hqPlusWorkView({
    tree: hqPlusChatTree(items, facts),
    links: facts,
    sessions: [
      session('closed-lead', 2 * DAY + 5),
      session('old-closed', DAY - 1),
      session('not-in-work', 2 * DAY + 9),
      session('lead', 2 * DAY + 9, true)
    ],
    since: DAY
  })
  const blocks = view.runs.map((run) => ({
    lead: run.lead?.key ?? `closed:${run.leadSession}`,
    rows: run.rows.map((row) => `${'  '.repeat(row.depth)}${row.item.key}`)
  }))

  it('makes a block per lead, the one that needs the owner first', () => {
    expect(blocks).toEqual([
      { lead: 'support', rows: ['support', '  support-sync'] },
      { lead: 'lead', rows: ['lead', '  brain', '    brain-api', '  agents'] },
      { lead: 'closed:closed-lead', rows: ['orphan', 'orphan-2'] }
    ])
  })

  it('leaves a chat nobody started out of the blocks', () => {
    expect(view.runs.flatMap((run) => run.rows).some((row) => row.item.key === 'alone')).toBe(false)
  })

  it('puts the tree chats that wait on the owner on top, in the blocks order', () => {
    expect(view.needsYou.map((item) => item.key)).toEqual(['support-sync', 'brain'])
  })

  it('sums each block: chats, projects, working, needs you', () => {
    expect(view.runs.map((run) => run.counts)).toEqual([
      { chats: 2, projects: 1, working: 1, needsYou: 1 },
      { chats: 4, projects: 4, working: 2, needsYou: 1 },
      { chats: 2, projects: 1, working: 1, needsYou: 0 }
    ])
  })

  it('lists the closed work chats active today, newest first', () => {
    expect(view.closedActiveToday.map((closed) => closed.sessionId)).toEqual(['closed-lead'])
  })

  it('names that list by the activity it filters on, not by the closing time it does not know', () => {
    expect(HQ_PLUS_WORK_CLOSED_HEADING).not.toMatch(/closed today/i)
    expect(HQ_PLUS_WORK_CLOSED_HEADING).toMatch(/active today/i)
  })

  it('keeps every chat a closed lead started in its block, a chat that started others too', () => {
    const tree = links([
      ['worker', 'gone-lead'],
      ['sub-lead', 'gone-lead'],
      ['sub-kid', 'sub-lead']
    ])
    const work = hqPlusWorkView({
      tree: hqPlusChatTree(
        [
          chat('worker', 'working', 10),
          chat('sub-lead', 'done', 20),
          chat('sub-kid', 'working', 30)
        ],
        tree
      ),
      links: tree,
      sessions: [],
      since: DAY
    })
    expect(
      work.runs.map((run) => ({
        lead: run.lead?.key ?? `closed:${run.leadSession}`,
        rows: run.rows.map((row) => `${'  '.repeat(row.depth)}${row.item.key}`)
      }))
    ).toEqual([{ lead: 'closed:gone-lead', rows: ['sub-lead', '  sub-kid', 'worker'] }])
  })
})

describe('HQ+ «Work» last report', () => {
  it('keeps the open root of a loop in the links as its lead (codex review 08.11)', () => {
    const loop = [chat('a', 'working', 10), chat('b', 'working', 20)]
    const loopLinks = links([
      ['a', 'b'],
      ['b', 'a']
    ])
    const view = hqPlusWorkView({
      tree: hqPlusChatTree(loop, loopLinks),
      links: loopLinks,
      sessions: [],
      since: 0
    })
    expect(view.runs).toHaveLength(1)
    expect(view.runs[0].lead).not.toBeNull()
    expect(view.runs[0].key.startsWith('closed:')).toBe(false)
  })

  it('takes the first line with words, without markdown marks', () => {
    expect(hqPlusFirstLine('\n\n## **Done**: merged\nmore')).toBe('Done: merged')
    expect(hqPlusFirstLine('- `fix` shipped')).toBe('fix shipped')
    expect(hqPlusFirstLine('  \n ')).toBeNull()
    expect(hqPlusFirstLine(undefined)).toBeNull()
  })

  it('finds the MR the reply names', () => {
    expect(hqPlusMrOf('Готово, MR !41 влит')).toBe('!41')
    expect(hqPlusMrOf('see https://gitlab.com/acme/x/-/merge_requests/365 ok')).toBe('!365')
    expect(hqPlusMrOf('PR https://github.com/acme/x/pull/12')).toBe('#12')
    expect(hqPlusMrOf('(!7) in review')).toBe('!7')
    expect(hqPlusMrOf('Done!41 and wow!')).toBeNull()
    expect(hqPlusMrOf('no merge request here')).toBeNull()
    expect(hqPlusMrOf(null)).toBeNull()
  })
})

// Router v2 T2: the registry «person × topic» on Orca+'s own records — our DM messages to a person by
// the work they were bound to, our open waitings on them, the chats the owner sent their messages to.
import { afterEach, describe, expect, it } from 'vitest'
import { PulseDb } from './pulse-db'
import type { PulseCore } from './pulse-core'
import { ROUTER_TOPIC_WINDOW_MS, routerPersonTopics } from './pulse-router-topics'

const NOW = 1_792_700_000_000
const DAY = 24 * 60 * 60_000
const open: PulseDb[] = []
afterEach(() => {
  for (const db of open.splice(0)) {
    db.close()
  }
})

function setup() {
  const db = new PulseDb(':memory:')
  open.push(db)
  const core = Reflect.get(db, 'core') as PulseCore
  const sql = (text: string, ...args: unknown[]) => core.db.prepare(text).run(...(args as never[]))
  const session = (id: string, state = 'working', closedAt: number | null = null) =>
    sql(
      "INSERT INTO sessions (session_id, workspace, state, opened_at, last_activity_at, closed_at) VALUES (?, 'w', ?, 1, 1, ?)",
      id,
      state,
      closedAt
    )
  const conversation = (id: string, key: string, sessionId: string | null = null) =>
    sql(
      "INSERT INTO conversations (id, key, title, session_id, created_at, last_at) VALUES (?, ?, 't', ?, 1, 1)",
      id,
      key,
      sessionId
    )
  const message = (
    conversationId: string,
    ts: string,
    direction: 'in' | 'out',
    text: string,
    at: number,
    sessionId: string | null = null,
    authorId: string | null = null
  ) =>
    sql(
      "INSERT INTO conversation_messages (conversation_id, ts, direction, author_id, text, reader, at, session_id) VALUES (?, ?, ?, ?, ?, 'test', ?, ?)",
      conversationId,
      ts,
      direction,
      authorId,
      text,
      at,
      sessionId
    )
  sql(
    "INSERT INTO people (id, name, slack_user_id, created_at, updated_at) VALUES ('p1', 'Ann', 'U1', 1, 1)"
  )
  return { core, sql, session, conversation, message }
}

describe('routerPersonTopics', () => {
  it('one topic per work: our DM messages, our waitings, the owner’s choices — newest first', () => {
    const { core, sql, session, conversation, message } = setup()
    for (const id of ['W1', 'W2', 'W3']) {
      session(id)
    }
    conversation('c1', 'slack:D1:100.000001')
    message('c1', '100.000001', 'out', 'Is the price $69 for every plan?', NOW - 3 * DAY, 'W1')
    message('c1', '100.000002', 'in', 'Checking', NOW - 2 * DAY, null, 'U1')
    sql(
      "INSERT INTO waitings (id, direction, person_id, title, source, created_at, agent_session_id) VALUES ('w1', 'on-them', 'p1', 'Which SKU for the light box?', 'agent', ?, 'W2')",
      NOW - DAY
    )
    conversation('c2', 'slack:C9:200.000001', 'W3')
    message('c2', '200.000001', 'in', 'The deploy is red again', NOW - 4 * DAY, null, 'U1')

    const topics = routerPersonTopics(core, { slackUserId: 'U1', channel: 'D1', now: NOW })
    expect(topics.map((topic) => [topic.chat, topic.source, topic.text])).toEqual([
      ['W2', 'waiting', 'Which SKU for the light box?'],
      ['W1', 'message', 'Is the price $69 for every plan?'],
      ['W3', 'choice', 'The deploy is red again']
    ])
  })

  it('a message bound on Approve counts for the bound work; a handoff names the successor', () => {
    const { core, sql, session, conversation, message } = setup()
    session('ONEOFF')
    session('W1', 'closed', NOW - DAY)
    session('W1b')
    sql(
      "INSERT INTO journal (id, at, workspace, kind, session_id, title, needs, ref_kind, ref_id, source) VALUES ('j1', 1, 'w', 'session.handoff', 'W1b', 'Handoff', 'nobody', 'session', 'W1', 'test')"
    )
    conversation('c1', 'slack:D1:100.000001')
    message('c1', '100.000001', 'out', 'Which plan?', NOW - DAY, 'ONEOFF')
    sql(
      "INSERT INTO router_bindings (channel, ts, thread_ts, task, chat, source, at) VALUES ('D1', '100.000001', '100.000001', 'W1', 'ONEOFF', 'approve', ?)",
      NOW - DAY
    )
    const topics = routerPersonTopics(core, { slackUserId: 'U1', channel: 'D1', now: NOW })
    expect(topics.map((topic) => [topic.chat, topic.work, topic.text])).toEqual([
      ['W1b', 'W1', 'Which plan?']
    ])
  })

  it('leaves out a closed work with no Lead, a resolved waiting and talk older than the window', () => {
    const { core, sql, session, conversation, message } = setup()
    session('GONE', 'closed', NOW - DAY)
    session('OLD')
    session('W2')
    conversation('c1', 'slack:D1:100.000001')
    message('c1', '100.000001', 'out', 'Closed work', NOW - DAY, 'GONE')
    message('c1', '100.000002', 'out', 'Old talk', NOW - ROUTER_TOPIC_WINDOW_MS - DAY, 'OLD')
    sql(
      "INSERT INTO waitings (id, direction, person_id, title, source, status, created_at, resolved_at, agent_session_id) VALUES ('w1', 'on-them', 'p1', 'Answered', 'agent', 'resolved', ?, ?, 'W2')",
      NOW - 2 * DAY,
      NOW - DAY
    )
    expect(routerPersonTopics(core, { slackUserId: 'U1', channel: 'D1', now: NOW })).toEqual([])
    // As of before it was answered the waiting was a topic, and the old talk still in the window.
    expect(
      routerPersonTopics(core, { slackUserId: 'U1', channel: 'D1', now: NOW - 1.5 * DAY }).map(
        (topic) => topic.chat
      )
    ).toEqual(['W2', 'OLD'])
  })

  it('the message’s own conversation is no topic; a group DM brings no messages of others', () => {
    const { core, session, conversation, message } = setup()
    session('W3')
    session('W4')
    conversation('c2', 'slack:D1:300.000001', 'W3')
    message('c2', '300.000001', 'in', 'Here it is', NOW - DAY, null, 'U1')
    conversation('g1', 'slack:G1:400.000001')
    message('g1', '400.000001', 'out', 'To the whole group', NOW - DAY, 'W4')
    expect(
      routerPersonTopics(core, {
        slackUserId: 'U1',
        channel: 'G1',
        now: NOW,
        conversationKey: 'slack:D1:300.000001'
      })
    ).toEqual([])
  })

  it('a closed work with a live Lead goes to the Lead', () => {
    const { core, sql, session, conversation, message } = setup()
    session('W1', 'closed', NOW - DAY)
    session('L1')
    sql(
      "INSERT INTO chat_roles (session_id, role, at) VALUES ('L1', 'lead', 1), ('W1', 'worker', 1)"
    )
    sql(
      "INSERT INTO chat_links (session_id, parent_session_id, via, at) VALUES ('W1', 'L1', 'launch', 1)"
    )
    conversation('c1', 'slack:D1:100.000001')
    message('c1', '100.000001', 'out', 'Ready?', NOW - DAY, 'W1')
    expect(
      routerPersonTopics(core, { slackUserId: 'U1', channel: 'D1', now: NOW }).map((t) => t.chat)
    ).toEqual(['L1'])
  })
})

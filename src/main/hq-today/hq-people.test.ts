import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { hqPersonPageNotes, parseHqOrgCsv } from '../../shared/hq-people'
import type { OutgoingSentContext } from '../../shared/outgoing-approval/outgoing-sent-context'
import type {
  PulseApprovalOutcome,
  PulseDecision,
  PulsePerson,
  PulseWaiting,
  PulseWaitingDirection
} from '../../shared/pulse-types'
import {
  buildHqPeopleRows,
  buildHqPersonCard,
  planHqPeopleSync,
  readHqPeopleFiles
} from './hq-people'

const HEADER =
  'person_id,name,job_title,department,location,level,supervisor_id,reports_to,slack_user_id,clickup_user_id'
const ORG = [
  HEADER,
  '170,Dana Stone,CEO,Management,Israel,0,,,U1,C1',
  '173,Mark Hill,Head of IT,IT,Israel,1,170,Dana Stone,U173,C173',
  '"196","Brown, Oliver","AI Engineer","AI Integration",,2,173,Mark Hill,U196,'
].join('\n')

function person(id: string, name: string, ids: Partial<PulsePerson> = {}): PulsePerson {
  return {
    id,
    name,
    slackUserId: null,
    clickupUserId: null,
    role: null,
    notes: null,
    createdAt: 1,
    updatedAt: 1,
    ...ids
  }
}

function waiting(
  id: string,
  personId: string,
  direction: PulseWaitingDirection,
  title: string
): PulseWaiting {
  return {
    id,
    direction,
    personId,
    project: null,
    title,
    detail: null,
    source: 'manual',
    sourceRef: null,
    status: 'open',
    dueAt: null,
    resolution: null,
    createdAt: 1,
    resolvedAt: null,
    agentSessionId: null,
    paneKey: null,
    worktreeId: null,
    reply: null,
    replyAuthor: null,
    replyTs: null,
    repliedAt: null,
    replyDeliveredAt: null
  }
}

function sentContext(targetId: string, targetName: string | null): OutgoingSentContext {
  return {
    service: 'Slack',
    operation: null,
    targetName,
    targetId,
    threadTs: null,
    replyingTo: null,
    chatName: null,
    agentSessionId: null,
    worktreeId: null,
    project: null,
    head: null,
    taskId: null,
    taskUrl: null,
    taskName: null,
    ref: null,
    footer: null,
    movedTo: null
  }
}

function approval(
  id: string,
  sent: OutgoingSentContext,
  outcome: PulseApprovalOutcome = 'approved'
): PulseDecision {
  return {
    id,
    kind: 'approval',
    title: `Slack · ${id}`,
    body: null,
    outcome,
    project: null,
    personId: null,
    draftId: null,
    source: 'outgoing-approval',
    decidedAt: 10,
    mirroredPath: null,
    sentContext: sent
  }
}

function hqWithPeople(pages: Record<string, string>, extra?: string): string {
  const hq = mkdtempSync(join(tmpdir(), 'hq-people-'))
  mkdirSync(join(hq, 'people'))
  writeFileSync(join(hq, 'people', 'org.csv'), `﻿${ORG}\n`)
  if (extra) {
    writeFileSync(join(hq, 'people', 'org-extra.csv'), extra)
  }
  for (const [name, text] of Object.entries(pages)) {
    writeFileSync(join(hq, 'people', name), text)
  }
  return hq
}

const PETYA_PAGE = [
  '---',
  'pulse_person_id: "p-zh"',
  'org_person_id: "173"',
  '---',
  '',
  '# Петя',
  '',
  '<!-- orca-pulse:person -->',
  '- **Decisions:** none yet',
  '<!-- /orca-pulse:end -->',
  '',
  '## Notes',
  '',
  '<!-- hidden -->',
  '- CTO, он.'
].join('\n')

describe('HQ people', () => {
  it('reads quoted CSV cells, the BOM, and adds org-extra rows the matrix lacks', async () => {
    expect(parseHqOrgCsv(ORG)[2]).toMatchObject({
      key: '196',
      name: 'Brown, Oliver',
      supervisorKey: '173',
      clickupUserId: null
    })
    const hq = hqWithPeople(
      { 'петя.md': PETYA_PAGE },
      `${HEADER}\n173,Duplicate,,,,,,,,\nx-anna,Clara Wood,IT Business Analyst,IT,,,,,U9,C9\n`
    )
    const files = await readHqPeopleFiles(hq)
    expect(files.org.map((row) => row.name)).toEqual([
      'Dana Stone',
      'Mark Hill',
      'Brown, Oliver',
      'Clara Wood'
    ])
    expect(files.pages[0]).toMatchObject({
      path: 'people/петя.md',
      pulsePersonId: 'p-zh',
      orgKey: '173',
      notes: '- CTO, он.'
    })
    expect(hqPersonPageNotes('# X\n\nno notes')).toBeNull()
  })

  it('joins a pulse person to their org row by page, keeps their own name, counts open waitings', async () => {
    const files = await readHqPeopleFiles(hqWithPeople({ 'петя.md': PETYA_PAGE }))
    const waitings = [
      waiting('w1', 'p-zh', 'on-me', 'Ответить про трек'),
      waiting('w2', 'p-ext', 'on-them', 'Счёт')
    ]
    const rows = buildHqPeopleRows({
      files,
      people: [person('p-zh', 'Петя'), person('p-ext', 'Подрядчик', { role: 'Дизайнер' })],
      waitings
    })
    expect(rows.find((row) => row.key === '173')).toMatchObject({
      name: 'Петя',
      orgName: 'Mark Hill',
      pulsePersonId: 'p-zh',
      pagePath: 'people/петя.md',
      onMe: 1,
      onThem: 0
    })
    expect(rows.at(-1)).toMatchObject({
      key: 'pulse:p-ext',
      name: 'Подрядчик',
      jobTitle: 'Дизайнер',
      onThem: 1
    })
  })

  it('lists what went to the person through Approve, by Slack id or a DM in their name', async () => {
    const files = await readHqPeopleFiles(hqWithPeople({ 'петя.md': PETYA_PAGE }))
    const sources = { files, people: [person('p-zh', 'Петя')], waitings: [] }
    const row = buildHqPeopleRows(sources).find((entry) => entry.key === '173')
    if (!row) {
      throw new Error('no row for 173')
    }
    const card = buildHqPersonCard(row, {
      ...sources,
      decisions: [
        approval('by-id', sentContext('U173', null)),
        approval('by-dm', sentContext('D1', 'DM with Mark Hill')),
        approval('rejected', sentContext('U173', null), 'rejected'),
        approval('other', sentContext('U1', 'DM with Dana Stone'))
      ]
    })
    expect(card.sent.map((entry) => entry.id)).toEqual(['by-id', 'by-dm'])
    expect(card.notes).toBe('- CTO, он.')
  })

  it('fills missing ids and the role, never takes an id another person holds, then has nothing to do', async () => {
    const files = await readHqPeopleFiles(hqWithPeople({ 'петя.md': PETYA_PAGE }))
    const people = [
      person('p-zh', 'Петя'),
      person('p-ceo', 'Dana Stone'),
      // A duplicate the scout made already holds the CEO's Slack id.
      person('p-dup', 'Авиэль', { slackUserId: 'U1' })
    ]
    const plan = planHqPeopleSync(people, files)
    expect(plan).toEqual([
      {
        id: 'p-zh',
        name: 'Петя',
        slackUserId: 'U173',
        clickupUserId: 'C173',
        role: 'Head of IT · IT'
      },
      {
        id: 'p-ceo',
        name: 'Dana Stone',
        slackUserId: null,
        clickupUserId: 'C1',
        role: 'CEO · Management'
      },
      {
        id: 'p-dup',
        name: 'Авиэль',
        slackUserId: 'U1',
        clickupUserId: null,
        role: 'CEO · Management'
      }
    ])
    const synced = people.map((entry): PulsePerson => {
      const update = plan.find((candidate) => candidate.id === entry.id)
      return update
        ? {
            ...entry,
            slackUserId: update.slackUserId ?? null,
            clickupUserId: update.clickupUserId ?? null,
            role: update.role ?? null
          }
        : entry
    })
    expect(planHqPeopleSync(synced, files)).toEqual([])
  })
})

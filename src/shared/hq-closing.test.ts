import { describe, expect, it } from 'vitest'
import type { ClickUpStatus, ClickUpTaskSummary } from './clickup-types'
import {
  findCheckStatus,
  hqCommentDraft,
  parseHqHours,
  readyHqTasks,
  type HqAgentCardLike
} from './hq-closing'
import type { HqTriageDecision } from './hq-triage'

function status(name: string, type: ClickUpStatus['type'] = 'custom'): ClickUpStatus {
  return { name, color: null, type, orderIndex: 0 }
}

function task(id: string, statusName = 'in proсess'): ClickUpTaskSummary {
  return {
    id,
    customId: null,
    identifier: `DEV-${id}`,
    title: 't',
    url: 'u',
    status: status(statusName),
    priority: null,
    assignees: [],
    dueDate: null,
    updatedAt: null,
    listId: 'l',
    listName: null,
    spaceId: null,
    workspaceId: null
  }
}

function card(
  paneKey: string,
  bucket: HqAgentCardLike['bucket'],
  extra: Partial<HqAgentCardLike> = {}
): HqAgentCardLike {
  return { paneKey, worktreeId: 'w1', bucket, finishedAt: null, ...extra }
}

const taken: HqTriageDecision = { decision: 'taken', at: 1, worktreeId: 'w1', paneKey: 'p1' }

describe('HQ closing', () => {
  it('lists a taken task once its agent is done, and keeps it while a closing step runs', () => {
    expect(readyHqTasks([task('1')], { 1: taken }, [card('p1', 'done')])).toHaveLength(1)
    expect(readyHqTasks([task('1')], { 1: taken }, [card('p1', 'working')])).toHaveLength(0)
    // No card yet: the agent has not reported, which is not «finished».
    expect(readyHqTasks([task('1')], { 1: taken }, [])).toHaveLength(0)
    expect(
      readyHqTasks([task('1')], { 1: { ...taken, acceptedAt: 5 } }, [card('p1', 'working')])
    ).toHaveLength(1)
  })

  it('leaves out tasks taken before HQ remembered the worktree, and tasks already in check', () => {
    const old: HqTriageDecision = { decision: 'taken', at: 1, repoId: 'r' }
    expect(readyHqTasks([task('1')], { 1: old }, [])).toHaveLength(0)
    expect(readyHqTasks([task('1', 'Check')], { 1: taken }, [card('p1', 'done')])).toHaveLength(0)
  })

  it('never guesses a coordinator among the HQ workspace chats', () => {
    const coordinator: HqTriageDecision = { ...taken, paneKey: undefined, coordinator: true }
    expect(readyHqTasks([task('1')], { 1: coordinator }, [card('p9', 'done')])).toHaveLength(0)
    const closing = { ...coordinator, commentedAt: 3 }
    expect(readyHqTasks([task('1')], { 1: closing }, [card('p9', 'done')])[0]?.agent).toBeNull()
    const single: HqTriageDecision = { ...taken, paneKey: undefined }
    expect(readyHqTasks([task('1')], { 1: single }, [card('p9', 'done')])[0]?.agent?.paneKey).toBe(
      'p9'
    )
  })

  it('takes the comment draft only from an answer that came after it was asked', () => {
    const asked = { ...taken, commentAskedAt: 100 }
    const answer = { lastAgentMessage: ' Сделано: … ' }
    expect(hqCommentDraft(asked, card('p1', 'done', { ...answer, finishedAt: 50 }))).toBeNull()
    expect(hqCommentDraft(asked, card('p1', 'working', { ...answer, finishedAt: 150 }))).toBeNull()
    expect(hqCommentDraft(asked, card('p1', 'idle', { ...answer, finishedAt: 150 }))).toBe(
      'Сделано: …'
    )
    expect(hqCommentDraft(taken, card('p1', 'done', { ...answer, finishedAt: 150 }))).toBeNull()
    // Accept or rework after the request: the last answer is about that, not the comment.
    const later = { ...asked, lastToldAt: 120 }
    expect(hqCommentDraft(later, card('p1', 'done', { ...answer, finishedAt: 150 }))).toBeNull()
  })

  it('finds the check status by name and reads typed hours', () => {
    expect(findCheckStatus([status('in proсess'), status('check')])?.name).toBe('check')
    expect(findCheckStatus([status('checked')])).toBeNull()
    expect(parseHqHours('1,5')).toBe(1.5)
    expect(parseHqHours('0')).toBeNull()
    expect(parseHqHours('abc')).toBeNull()
  })
})

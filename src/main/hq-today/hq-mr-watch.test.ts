import { describe, expect, it, vi } from 'vitest'
import { PulseDb } from '../orca-plus/pulse/pulse-db'
import type { HqMrRef, HqMrState } from '../../shared/hq-mr-watch'
import { readHqWaitingTags } from '../../shared/hq-waiting-tags'
import { createHqMrWatch } from './hq-mr-watch'

const NOW = 1_800_000_000_000
const REPOS = ['acme/acme-hub', 'acme/acme-priority-bridge']

function setup(states: Record<number, Partial<HqMrState>>) {
  let id = 0
  const db = new PulseDb(':memory:', { now: () => NOW, newId: () => `w${++id}` })
  const getMr = vi.fn(async (ref: HqMrRef): Promise<HqMrState | null> => {
    const state = states[ref.iid]
    return state
      ? {
          state: 'opened',
          title: `MR ${ref.iid}`,
          url: `https://gitlab.com/${ref.projectPath}/-/merge_requests/${ref.iid}`,
          mergedBy: null,
          mergedAt: null,
          closedAt: null,
          approvedBy: [],
          ...state
        }
      : null
  })
  const judge = vi.fn(async () => 'acme/acme-priority-bridge')
  const watch = createHqMrWatch({
    listOpen: () => db.listWaitings({ status: 'open' }),
    listRepos: async () => REPOS,
    getMr,
    judge,
    recordReply: (waitingId, reply) => db.recordWaitingReply(waitingId, reply),
    setDetail: (waitingId, detail) => void db.updateWaiting(waitingId, { detail }),
    now: () => NOW + 60_000
  })
  const ask = (title: string, project: string) =>
    db.addWaiting({ direction: 'on-them', title, project, source: 'slack' })
  return { db, watch, getMr, judge, ask }
}

describe('MR watch', () => {
  it("answers a waiting from GitLab once its MR is merged, reading «!N» against the project's repo", async () => {
    const { db, watch, ask } = setup({ 381: { state: 'merged', mergedBy: 'Ann' } })
    const merge = ask('Влить hub !381 и ответить на 2 вопроса', 'acme-hub')
    expect(await watch.poll()).toBe(1)
    expect(db.getWaiting(merge.id)).toMatchObject({
      status: 'open',
      reply: 'GitLab: MR !381 (acme/acme-hub) merged by Ann — MR 381',
      replyAuthor: 'GitLab',
      replyAuthorId: 'gitlab',
      replyLink: 'https://gitlab.com/acme/acme-hub/-/merge_requests/381'
    })
    // Why: answered once; the owner passes it to the chat or skips it.
    expect(await watch.poll()).toBe(0)
  })

  it('writes what GitLab sees on a waiting still open, once per change', async () => {
    const { db, watch, ask } = setup({ 380: {} })
    const approve = ask('Апрув hub !380: spec edits', 'acme-hub')
    await watch.poll()
    expect(readHqWaitingTags(db.getWaiting(approve.id)?.detail ?? null).checked).toMatch(
      /— GitLab: !380 opened, no approvals$/
    )
    const detail = db.getWaiting(approve.id)?.detail
    await watch.poll()
    expect(db.getWaiting(approve.id)?.detail).toBe(detail)
    expect(watch.watched()).toBe(1)
  })

  it('asks the model for the repo once per project when the name does not match', async () => {
    const { db, watch, judge, getMr, ask } = setup({ 12: { state: 'merged' } })
    ask('Влить !12 — SDK switch', 'flowbridge')
    ask('Влить !13 — SDK docs', 'flowbridge')
    await watch.poll()
    expect(judge).toHaveBeenCalledOnce()
    expect(getMr).toHaveBeenCalledWith({
      host: 'gitlab.com',
      projectPath: 'acme/acme-priority-bridge',
      iid: 12
    })
    expect(db.listWaitings({ status: 'open' }).filter((w) => w.replyAuthorId === 'gitlab')).toHaveLength(1)
  })

  it("leaves a waiting alone while a person's answer is not handled yet", async () => {
    const { db, watch, getMr, ask } = setup({ 381: { state: 'merged' } })
    const merge = ask('Влить hub !381', 'acme-hub')
    db.recordWaitingReply(merge.id, { text: 'Влила', author: 'Ann', ts: '1800000001.000000' })
    expect(await watch.poll()).toBe(0)
    expect(getMr).not.toHaveBeenCalled()
  })
})

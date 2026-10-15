import { describe, expect, it, vi } from 'vitest'
import type { HqSlackScoutDraft } from '../../shared/hq-slack-scout'
import { HQ_SLACK_REQUEST_ACTION, readHqSlackRequestRef } from '../../shared/hq-slack-request-bell'
import { hqSlackRequestBellItems, startHqSlackRequestBell } from './hq-slack-request-bell'

const draft = (over: Partial<HqSlackScoutDraft> = {}): HqSlackScoutDraft => ({
  id: 'D1:2',
  channelName: 'DM Ирина',
  author: 'Ирина',
  permalink: 'https://slack/p',
  quote: 'Глеб, проверь тикеты',
  title: 'Проверить тикеты',
  description: '',
  foundAt: '',
  ...over
})

const deps = (drafts: HqSlackScoutDraft[], enabled = true) => ({
  hqPath: () => '/hq',
  enabled: () => enabled,
  readScout: vi.fn(async () => ({
    ok: true as const,
    configured: true,
    lastRunAt: null,
    failedAt: null,
    drafts
  })),
  listPages: vi.fn(async () => [
    {
      repoId: 'r1',
      slug: 'lh_support_ai_service',
      title: 'lh_support_ai_service — Samantha',
      status: null,
      group: null,
      relations: []
    }
  ])
})

describe('Slack request bell items', () => {
  it('names who asks what, the project by its short name, and leads with the suggested answer', async () => {
    const items = await hqSlackRequestBellItems(
      deps([draft({ kind: 'answer', ask: 'проверь тикеты', project: 'lh_support_ai_service' })])
    )
    expect(items).toHaveLength(1)
    const [item] = items!
    expect(item).toMatchObject({
      kind: 'slack-request',
      title: 'Ирина: проверь тикеты',
      body: 'Reply · lh_support_ai_service · DM Ирина\n«Глеб, проверь тикеты»'
    })
    expect(item!.dedupeKey?.startsWith('slack-request:D1:2:')).toBe(true)
    expect(item!.actions?.map((action) => action.id)).toEqual([
      HQ_SLACK_REQUEST_ACTION.answer,
      HQ_SLACK_REQUEST_ACTION.do,
      HQ_SLACK_REQUEST_ACTION.edit,
      HQ_SLACK_REQUEST_ACTION.skip
    ])
    expect(readHqSlackRequestRef(item!.refId ?? null)).toEqual({ id: 'D1:2', kind: 'answer' })
  })

  it('gives a corrected request a new item, and an unchanged one the same', async () => {
    const [before] = (await hqSlackRequestBellItems(deps([draft({ ask: 'a' })])))!
    const [same] = (await hqSlackRequestBellItems(deps([draft({ ask: 'a' })])))!
    const [after] = (await hqSlackRequestBellItems(deps([draft({ ask: 'b' })])))!
    expect(same!.dedupeKey).toBe(before!.dedupeKey)
    expect(after!.dedupeKey).not.toBe(before!.dedupeKey)
  })

  it('reads an old draft as a task with an unknown project, without listing pages', async () => {
    const d = deps([draft()])
    const [item] = (await hqSlackRequestBellItems(d))!
    expect(item!.title).toBe('Ирина: Проверить тикеты')
    expect(item!.body?.startsWith('Do · project? · DM Ирина')).toBe(true)
    expect(d.listPages).not.toHaveBeenCalled()
  })

  it('closes everything with «New view» off, and keeps items when the files cannot be read', async () => {
    await expect(hqSlackRequestBellItems(deps([draft()], false))).resolves.toEqual([])
    const failing = {
      ...deps([]),
      readScout: vi.fn(async () => ({ ok: false as const, error: 'x' }))
    }
    await expect(hqSlackRequestBellItems(failing)).resolves.toBeNull()
  })

  it('syncs at start and again after HQ records a decision', async () => {
    const sync = vi.fn()
    let changed: () => void = () => undefined
    const stop = startHqSlackRequestBell({
      ...deps([draft()]),
      sync,
      onChanged: (listener) => {
        changed = listener
        return () => undefined
      }
    })
    await vi.waitFor(() => expect(sync).toHaveBeenCalledTimes(1))
    changed()
    await vi.waitFor(() => expect(sync).toHaveBeenCalledTimes(2))
    expect(sync.mock.calls[1]![0]).toBe('slack-request')
    stop()
  })
})

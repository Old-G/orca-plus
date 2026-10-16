import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OutgoingDraftCall } from '../../shared/outgoing-approval/outgoing-action'
import type { PulseDraft } from '../../shared/pulse-types'
import {
  appendHqReplyCorrection,
  hqReplyCorrectionFromApproval,
  keepHqApprovalEdits,
  readHqReplyCorrections
} from './hq-reply-corrections'

let hq: string

const call = (over: Partial<OutgoingDraftCall> = {}): OutgoingDraftCall => ({
  agent: 'claude',
  toolName: 'mcp__claude_ai_Slack__slack_send_message',
  toolInput: { channel_id: 'C1', message: 'Добрый день! Сделаю до пятницы.' },
  toolUseId: null,
  sessionId: null,
  cwd: null,
  paneKey: null,
  agentSessionId: null,
  service: 'Slack',
  operation: 'send message',
  editField: 'message',
  ...over
})

const decided = (body: string, held: OutgoingDraftCall | null = call()): PulseDraft => ({
  id: 'd1',
  kind: 'message',
  target: 'C1',
  title: null,
  body,
  project: null,
  personId: null,
  source: 'gate',
  sourceRef: null,
  fingerprint: null,
  status: 'approved',
  createdAt: 1,
  updatedAt: 2,
  call: held
})

beforeEach(() => {
  hq = mkdtempSync(join(tmpdir(), 'hq-reply-corrections-'))
})

afterEach(() => {
  rmSync(hq, { recursive: true, force: true })
})

describe('HQ reply corrections', () => {
  it("takes a Slack message the owner rewrote in Approve: the agent's text against what went out", () => {
    expect(hqReplyCorrectionFromApproval(decided('Сделаю в пятницу)'), 'edited', 7)).toEqual({
      at: 7,
      source: 'slack',
      id: 'd1',
      draft: 'Добрый день! Сделаю до пятницы.',
      sent: 'Сделаю в пятницу)'
    })
  })

  it('learns nothing from an approval as is, a rejection, or a call that is not a Slack message', () => {
    expect(hqReplyCorrectionFromApproval(decided('x'), 'approved', 7)).toBeNull()
    expect(hqReplyCorrectionFromApproval(decided('x'), 'rejected', 7)).toBeNull()
    expect(
      hqReplyCorrectionFromApproval(decided('x', call({ service: 'ClickUp' })), 'edited', 7)
    ).toBeNull()
    expect(hqReplyCorrectionFromApproval(decided('x', null), 'edited', 7)).toBeNull()
  })

  it('keeps changed drafts only, and reads back the newest few', async () => {
    const entry = { at: 1, source: 'slack' as const, id: 'a' }
    await expect(
      appendHqReplyCorrection(hq, { ...entry, draft: 'Сделаю.', sent: ' Сделаю. ' })
    ).resolves.toBe(false)
    for (const index of [1, 2, 3, 4, 5, 6]) {
      await appendHqReplyCorrection(hq, {
        ...entry,
        draft: `черновик ${index}`,
        sent: `ок ${index}`
      })
    }
    const lessons = await readHqReplyCorrections(hq)
    expect(lessons).toHaveLength(5)
    expect(lessons.at(-1)).toEqual({ draft: 'черновик 6', sent: 'ок 6' })
  })

  it('writes an Approve edit into the HQ folder, and nothing without one', async () => {
    keepHqApprovalEdits(() => null)(decided('Сделаю)'), 'edited')
    keepHqApprovalEdits(
      () => hq,
      () => 9
    )(decided('Сделаю)'), 'edited')
    await vi.waitFor(async () =>
      expect(await readHqReplyCorrections(hq)).toEqual([
        { draft: 'Добрый день! Сделаю до пятницы.', sent: 'Сделаю)' }
      ])
    )
  })
})

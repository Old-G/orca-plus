import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentJournalItemBody } from '../../../shared/agent-session/journal/agent-session-journal-types'
import type { AgentJournalSubmission } from '../../../shared/agent-session/journal/agent-session-journal-types'
import type { AgentSessionRecord } from '../../../shared/agent-session/lifecycle/agent-session-record'
import type { AgentSessionJournal } from '../agent-session-journal/journal-store'
import { effortJournal } from '../../hq-journal/hq-effort-journal'
import {
  autoEffortMessageOptions,
  provideAutoEffortLog,
  provideNativeChatAutoEffort,
  withAutoEffort,
  type AutoEffortLogEntry,
  type NativeChatAutoEffortService
} from './native-chat-auto-effort'
import { effortRoute, isRelayedText, leadSessionIdsFromPlans } from './chat-role-effort'
import { createChatRoleOf } from './lead-plan-registry'

const user = (text: string): AgentJournalItemBody => ({
  kind: 'message',
  role: 'user',
  blocks: [{ type: 'text', text }]
})

function serve(over: Partial<NativeChatAutoEffortService> = {}) {
  const pick = vi.fn(async () => 'low' as const)
  provideNativeChatAutoEffort({ enabled: () => true, pick, ...over })
  return pick
}

afterEach(() => {
  provideNativeChatAutoEffort(null)
  provideAutoEffortLog(null)
})

describe('effort route by role and sender', () => {
  it('fixes a lead, a sub-lead and a reviewer at medium', () => {
    for (const role of ['lead', 'sublead', 'review'] as const) {
      expect(effortRoute({ role, fromPerson: true, text: 'go' })).toEqual({
        kind: 'fixed',
        effort: 'medium'
      })
    }
  })

  it('keeps a relayed message off the classifier, and asks for the owner’s own', () => {
    expect(effortRoute({ role: 'worker', fromPerson: false, text: 'go' })).toEqual({
      kind: 'relayed'
    })
    expect(effortRoute({ role: null, fromPerson: true, text: 'go' })).toEqual({ kind: 'ask' })
    expect(effortRoute({ role: 'worker', fromPerson: true, text: 'fix the build' })).toEqual({
      kind: 'ask'
    })
  })

  it('knows a chat-send head and a lead brief by their first words, typed in or not', () => {
    for (const text of [
      'Orca+ · a message from thread acme/lead-goal:\n"""\nok\n"""',
      'От лида: Ann 01.01: do b',
      'Lead: carry on',
      'W · Task one. От лида (Lead · goal)',
      '  LEAD · goal',
      'SUB-LEAD · goal › acme',
      'REVIEW · task'
    ]) {
      expect(isRelayedText(text), text).toBe(true)
    }
    for (const text of ['ok', 'Why did the lead stop?', 'W is a letter', 'Leading zeros']) {
      expect(isRelayedText(text), text).toBe(false)
    }
  })
})

describe('lead plan registry', () => {
  const plan = [
    '# Lead · goal',
    'Lead chat: `acme/lead-goal` (claude_aaaa_1111) · started 2026-01-01',
    'Lead chat: acme/old (claude_bbbb_2222; until 13.11 — claude_cccc) · started',
    'Not a Lead chat: (claude_ffff)'
  ].join('\n')

  it('reads the session ids on «Lead chat:» lines', () => {
    expect([...leadSessionIdsFromPlans([plan])]).toEqual(['claude_aaaa_1111', 'claude_bbbb_2222'])
  })

  it('takes the launched role first, a plan file’s lead next, and reads the plans once a minute', async () => {
    let clock = 0
    const listDir = vi.fn(async () => ['plan.md', 'notes.txt'])
    const readText = vi.fn(async () => plan)
    const launched: Record<string, 'review' | 'worker'> = {
      claude_aaaa_2222: 'review',
      claude_aaaa_3333: 'worker'
    }
    const roleOf = createChatRoleOf({
      hqPath: () => '/hq',
      launchedRole: (sessionId) => launched[sessionId] ?? null,
      now: () => clock,
      listDir,
      readText
    })
    const record = (sessionId: string) => ({ sessionId }) as unknown as AgentSessionRecord
    expect(await roleOf(record('claude_aaaa_1111'))).toBe('lead')
    expect(await roleOf(record('claude_aaaa_2222'))).toBe('review')
    expect(await roleOf(record('claude_aaaa_3333'))).toBe('worker')
    expect(await roleOf(record('claude_other'))).toBeNull()
    expect(readText).toHaveBeenCalledOnce()
    // Why: the registry builds the path with node:path, so on Windows it reads \hq\runs\plan.md.
    expect(readText).toHaveBeenCalledWith(join('/hq', 'runs', 'plan.md'))
    launched.claude_aaaa_1111 = 'worker'
    expect(await roleOf(record('claude_aaaa_1111'))).toBe('worker')
    clock = 61_000
    await roleOf(record('claude_other'))
    expect(readText).toHaveBeenCalledTimes(2)
  })

  it('finds no lead without an HQ folder or a runs folder', async () => {
    const record = { sessionId: 'claude_aaaa_1111' } as unknown as AgentSessionRecord
    expect(await createChatRoleOf({ hqPath: () => null })(record)).toBeNull()
    const missing = createChatRoleOf({
      hqPath: () => '/hq',
      listDir: async () => {
        throw new Error('ENOENT')
      }
    })
    expect(await missing(record)).toBeNull()
  })
})

describe('chat auto effort by role', () => {
  const base = { provider: 'claude', body: user('go'), items: () => [] }

  it('gives a lead medium without asking Jev, whatever effort the chat had', async () => {
    const pick = serve()
    for (const effort of ['xhigh', 'low', 'max']) {
      expect(
        await autoEffortMessageOptions({ ...base, role: 'lead', options: { effort } })
      ).toEqual({ effort: 'medium' })
    }
    expect(pick).not.toHaveBeenCalled()
  })

  it('works without a key for a lead, and keeps a model that has no medium as it is', async () => {
    serve()
    expect(await autoEffortMessageOptions({ ...base, role: 'lead', options: {} })).toEqual({
      effort: 'medium'
    })
    expect(
      await autoEffortMessageOptions({
        ...base,
        role: 'lead',
        options: { effort: 'high' },
        effortLevels: () => new Set(['high', 'xhigh'])
      })
    ).toEqual({ effort: 'high' })
  })

  it('keeps a worker’s effort for a relayed message, and asks for the owner’s own', async () => {
    const pick = serve()
    const relayed = await autoEffortMessageOptions({
      ...base,
      role: 'worker',
      fromPerson: false,
      options: { effort: 'high' }
    })
    expect(relayed).toEqual({ effort: 'high' })
    const brief = await autoEffortMessageOptions({
      ...base,
      body: user('От лида: Ann 01.01: b. Do it'),
      options: { effort: 'high' }
    })
    expect(brief).toEqual({ effort: 'high' })
    expect(pick).not.toHaveBeenCalled()
    expect(
      await autoEffortMessageOptions({ ...base, role: 'worker', options: { effort: 'high' } })
    ).toEqual({ effort: 'low' })
    expect(pick).toHaveBeenCalledOnce()
  })

  it('writes every choice to the journal with the chat’s role', async () => {
    serve()
    const entries: AutoEffortLogEntry[] = []
    provideAutoEffortLog((entry) => entries.push(entry))
    await autoEffortMessageOptions({ ...base, role: 'lead', options: {}, messageId: 'm1' })
    await autoEffortMessageOptions({
      ...base,
      role: 'worker',
      fromPerson: false,
      options: { effort: 'high' },
      messageId: 'm2'
    })
    await autoEffortMessageOptions({ ...base, options: { effort: 'high' }, messageId: 'm3' })
    expect(entries.map(({ result, effort, role }) => ({ result, effort, role }))).toEqual([
      { result: 'role', effort: 'medium', role: 'lead' },
      { result: 'relayed', effort: 'high', role: 'worker' },
      { result: 'picked', effort: 'low', role: null }
    ])
    const place = () => ({ project: 'acme', room: 'room', hq: false, firm: true })
    const row = effortJournal(entries[0]!, place as never)
    expect(row.title).toBe('medium · role · lead: go')
    expect(row.source).toBe('effort:role:medium')
  })
})

describe('auto effort at delivery', () => {
  const record = {
    sessionId: 'claude_s1',
    provider: 'claude',
    location: {},
    options: { effort: 'high' }
  } as unknown as AgentSessionRecord
  const submission = (id: string, personal = true): AgentJournalSubmission =>
    ({
      clientMessageId: id,
      options: { effort: 'high' },
      source: { kind: personal ? 'user' : 'automation' }
    }) as unknown as AgentJournalSubmission
  // The SQL journal: a person's message is a user-sourced submission with no queued card.
  const journal = (_personal: boolean, text = 'go') =>
    ({
      reads: {
        itemBody: async () => user(text),
        conversationOutline: async () => ({ entries: [] })
      },
      queuedMessages: { get: async () => null }
    }) as unknown as AgentSessionJournal

  it('reads the chat’s role and the journal’s sender before it asks Jev', async () => {
    const pick = serve({ roleOf: async () => 'lead' })
    expect(await withAutoEffort(submission('d1'), record, journal(true))).toEqual({
      effort: 'medium'
    })
    serve({ pick, roleOf: async () => 'worker' })
    expect(await withAutoEffort(submission('d2', false), record, journal(false))).toEqual({
      effort: 'high'
    })
    expect(pick).not.toHaveBeenCalled()
    expect(await withAutoEffort(submission('d3'), record, journal(true))).toEqual({
      effort: 'low'
    })
    expect(pick).toHaveBeenCalledOnce()
  })

  it('asks Jev as before when the role cannot be read', async () => {
    const pick = serve({
      roleOf: async () => {
        throw new Error('broken')
      }
    })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    expect(await withAutoEffort(submission('d4'), record, journal(true))).toEqual({
      effort: 'low'
    })
    expect(pick).toHaveBeenCalledOnce()
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
})

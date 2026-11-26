import { describe, expect, it } from 'vitest'
import type { HqIntake } from '../../shared/hq-slack-intake'
import { PulseCore } from '../orca-plus/pulse/pulse-core'
import { bindChosenThread, logChoice, logRoute } from '../orca-plus/pulse/pulse-router-graph'
import { hqIntakeCloseRoute, hqRouterLogKey } from './hq-intake-close-route'

const intake = (extra: Partial<HqIntake> = {}): HqIntake => ({
  channel: 'D1',
  ts: '100.000002',
  threadTs: '100.000001',
  author: 'Ann',
  authorSlackId: 'U1',
  venue: 'dm',
  text: 'the export is green',
  links: [],
  files: [],
  permalink: null,
  at: 1,
  repoId: null,
  project: null,
  summary: '',
  ...extra
})

function recorder() {
  const calls: string[] = []
  return {
    calls,
    deps: {
      setConversationChat: (key: string, chat: string) => calls.push(`conv ${key} ${chat}`),
      bindChoice: (input: { channel: string; threadTs: string; chat: string }) =>
        calls.push(`bind ${input.channel}:${input.threadTs} ${input.chat}`),
      logChoice: (key: string, chat: string) => calls.push(`log ${key} ${chat}`),
      now: 5
    }
  }
}

describe('hqIntakeCloseRoute', () => {
  it('binds the thread to the chosen chat and logs the choice', () => {
    const { calls, deps } = recorder()
    hqIntakeCloseRoute(intake(), 'S1', deps)
    expect(calls).toEqual([
      'conv slack:D1:100.000001 S1',
      'bind D1:100.000001 S1',
      'log slack:D1:100.000002 S1'
    ])
  })

  it('only logs pasted text: it has no Slack thread', () => {
    const { calls, deps } = recorder()
    hqIntakeCloseRoute(intake({ channel: 'text', threadTs: null, pasted: true }), 'S2', deps)
    expect(calls).toEqual(['log slack:text:100.000002 S2'])
  })

  it('fills router_log.chosen and chosen_at and binds the thread in the pulse db', () => {
    const c = new PulseCore(':memory:', { now: () => 1_000, newId: () => 'x' })
    try {
      const card = intake()
      logRoute(c, {
        key: hqRouterLogKey(card),
        at: 1,
        how: 'model',
        target: 'S1',
        top: ['S1', 'S2'],
        auto: false
      })
      hqIntakeCloseRoute(card, 'S2', {
        setConversationChat: () => undefined,
        bindChoice: (input) => bindChosenThread(c, input),
        logChoice: (key, chat, at) => logChoice(c, key, chat, at),
        now: 7
      })
      expect(c.db.prepare('SELECT chosen, chosen_at FROM router_log').get()).toEqual({
        chosen: 'S2',
        chosen_at: 7
      })
      expect(
        c.db.prepare("SELECT ts, source FROM router_bindings WHERE source = 'choice'").get()
      ).toEqual({ ts: 'choice:100.000001', source: 'choice' })
    } finally {
      c.close()
    }
  })
})

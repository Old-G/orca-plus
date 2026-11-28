import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PulseBellInput } from '../../shared/pulse-bell'
import { slackReactionPushOf, type SlackReactionPush } from '../slack/slack-reaction-push'
import { pollHqSlackIntake, type HqSlackIntakeDeps } from './hq-slack-intake'
import { hqIntakePushKick, startHqSlackIntake } from './hq-slack-intake-watch'
import type { HqIntakeDraft } from './hq-slack-intake-suggest'

const NOW = Date.UTC(2026, 10, 28, 9)

function draft(ts: string): HqIntakeDraft {
  return {
    channel: 'D0AAAAAAAAA',
    ts,
    threadTs: null,
    author: 'Ann',
    authorSlackId: 'U1',
    venue: 'dm',
    text: 'Please look at the import',
    links: [],
    files: [],
    permalink: null,
    at: Math.round(Number(ts) * 1000)
  }
}

describe('slackReactionPushOf', () => {
  it('reads a reaction on a message, without the skin tone, with Slack’s time', () => {
    expect(
      slackReactionPushOf({
        type: 'reaction_added',
        user: 'UOWNER',
        reaction: 'space_invader::skin-tone-2',
        item: { type: 'message', channel: 'C1', ts: '1795850000.000100' },
        event_ts: '1795850001.500000'
      })
    ).toEqual({
      user: 'UOWNER',
      reaction: 'space_invader',
      channel: 'C1',
      ts: '1795850000.000100',
      at: 1795850001500
    })
  })

  it('ignores a reaction on a file and other events', () => {
    expect(
      slackReactionPushOf({
        type: 'reaction_added',
        user: 'UOWNER',
        reaction: 'space_invader',
        item: { type: 'file', file: 'F1' }
      })
    ).toBeNull()
    expect(slackReactionPushOf({ type: 'reaction_removed', user: 'UOWNER' })).toBeNull()
  })
})

describe('hqIntakePushKick', () => {
  const push = (user: string, reaction: string): SlackReactionPush => ({
    user,
    reaction,
    channel: 'C1',
    ts: '1795850000.000100',
    at: NOW - 400
  })

  it('wakes the watch only for the owner’s own 👾 or 🆕, and notes how late it came', () => {
    const kick = vi.fn()
    const notes: (number | null)[] = []
    const onPush = hqIntakePushKick({
      owner: () => 'UOWNER',
      marks: () => ['space_invader', 'new'],
      kick,
      note: (_push, lag) => void notes.push(lag),
      now: () => NOW
    })
    onPush(push('UOTHER', 'space_invader'))
    onPush(push('UOWNER', 'eyes'))
    expect(kick).not.toHaveBeenCalled()
    onPush(push('UOWNER', 'space_invader'))
    onPush(push('UOWNER', 'new'))
    expect(kick).toHaveBeenCalledTimes(2)
    expect(notes).toEqual([400, 400])
  })

  it('does nothing while no reader token names the owner, or with 🆕 off', () => {
    const kick = vi.fn()
    hqIntakePushKick({ owner: () => null, marks: () => ['space_invader'], kick, now: () => NOW })(
      push('UOWNER', 'space_invader')
    )
    hqIntakePushKick({
      owner: () => 'UOWNER',
      marks: () => ['space_invader', null],
      kick,
      now: () => NOW
    })(push('UOWNER', 'new'))
    expect(kick).not.toHaveBeenCalled()
  })
})

function watch(drafts: HqIntakeDraft[], raised = new Map<string, string | null>()) {
  const reads: { quick: boolean; mentions: boolean }[] = []
  const synced: PulseBellInput[][] = []
  const deps: HqSlackIntakeDeps = {
    read: async (run) =>
      run({
        marked: async (opts) => {
          reads.push({ quick: opts?.quick === true, mentions: false })
          return { drafts, complete: true }
        },
        mentioned: async () => {
          reads.push({ quick: false, mentions: true })
          return []
        }
      }),
    raised: () => raised,
    guess: async () => ({ repoId: 'r1', project: 'acme', summary: 'Import' }),
    sync: (_kind, items) => void synced.push([...items]),
    now: () => NOW
  }
  return { deps, reads, synced }
}

describe('a pushed mark gets a quick pass', () => {
  it('reads the newest reactions only, no mentions, and closes no card it did not see', async () => {
    const old = draft('1795849000.000100')
    const raisedCard = {
      ...old,
      repoId: 'r1',
      project: 'acme',
      summary: 'Earlier'
    }
    const { hqIntakeBellItem } = await import('../../shared/hq-slack-intake')
    const item = hqIntakeBellItem(raisedCard)
    const { deps, reads, synced } = watch(
      [draft('1795850000.000100')],
      new Map([[item.dedupeKey, item.refId ?? null]])
    )
    await pollHqSlackIntake(deps, { quick: true })
    expect(reads).toEqual([{ quick: true, mentions: false }])
    // Why: the quick read even said «complete», but it is one page — the earlier card stays.
    expect(synced[0]?.map((card) => card.dedupeKey).sort()).toEqual(
      [item.dedupeKey, 'hq-intake:D0AAAAAAAAA:1795850000.000100'].sort()
    )
  })
})

describe('quick pass and the cards it did not read (review)', () => {
  it('a reply 👾 joins the waiting card of its thread root, even when the root mark is past the quick page', async () => {
    const { hqIntakeBellItem } = await import('../../shared/hq-slack-intake')
    const root = draft('1795849000.000100')
    const item = hqIntakeBellItem({ ...root, repoId: 'r1', project: 'acme', summary: 'Root' })
    const reply = { ...draft('1795850000.000100'), threadTs: root.ts }
    const { deps, synced } = watch([reply], new Map([[item.dedupeKey, item.refId ?? null]]))
    const route = vi.fn(async () => null)
    deps.route = route
    await pollHqSlackIntake(deps, { quick: true })
    expect(route).not.toHaveBeenCalled()
    expect(synced[0]).toHaveLength(1)
    expect(synced[0]?.[0]?.dedupeKey).toBe(item.dedupeKey)
  })

  it('says -1 when there is no token to read with', async () => {
    const { deps } = watch([])
    deps.read = async () => null
    expect(await pollHqSlackIntake(deps)).toBe(-1)
  })
})

describe('startHqSlackIntake with pushes', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('a push before the first full pass runs a full one; later pushes run quick passes; the poll goes on', async () => {
    vi.useFakeTimers()
    const { deps, reads } = watch([draft('1795850000.000100')])
    let kick: () => void = () => {}
    const unsubscribe = vi.fn()
    const stop = startHqSlackIntake({
      ...deps,
      pushes: (wake) => {
        kick = wake
        return unsubscribe
      }
    })
    kick()
    await vi.advanceTimersByTimeAsync(0)
    expect(reads.filter((read) => !read.mentions)).toEqual([{ quick: false, mentions: false }])
    reads.length = 0
    kick()
    await vi.advanceTimersByTimeAsync(0)
    expect(reads).toEqual([{ quick: true, mentions: false }])
    reads.length = 0
    // Why: the socket may be down; the half-minute poll is the insurance and stays full.
    await vi.advanceTimersByTimeAsync(30_000)
    expect(reads).toContainEqual({ quick: false, mentions: false })
    expect(reads).toContainEqual({ quick: false, mentions: true })
    stop()
    expect(unsubscribe).toHaveBeenCalledTimes(1)
  })

  it('without a token the pass after a push stays full, so the first real look sees every mark', async () => {
    vi.useFakeTimers()
    const { deps, reads } = watch([draft('1795850000.000100')])
    let token = false
    const read = deps.read
    deps.read = async (run) => (token ? read(run) : null)
    let kick: () => void = () => {}
    const stop = startHqSlackIntake({ ...deps, pushes: (wake) => ((kick = wake), () => {}) })
    kick()
    await vi.advanceTimersByTimeAsync(0)
    token = true
    kick()
    await vi.advanceTimersByTimeAsync(0)
    expect(reads.filter((r) => !r.mentions)).toEqual([{ quick: false, mentions: false }])
    stop()
  })

  it('with no socket the half-minute poll goes on by itself', async () => {
    vi.useFakeTimers()
    const { deps, reads } = watch([draft('1795850000.000100')])
    const stop = startHqSlackIntake(deps)
    await vi.advanceTimersByTimeAsync(60_000)
    // 25 s first look, then the 30 s and 60 s ticks.
    expect(reads.filter((r) => !r.mentions)).toEqual([
      { quick: false, mentions: false },
      { quick: false, mentions: false },
      { quick: false, mentions: false }
    ])
    stop()
  })
})

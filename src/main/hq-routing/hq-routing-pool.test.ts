import { describe, expect, it } from 'vitest'
import { createLateWork, mapAtMost, orAfter } from './hq-routing-pool'

describe('routing pool', () => {
  it('runs at most the limit at once and keeps the order', async () => {
    let running = 0
    let most = 0
    const out = await mapAtMost([30, 10, 20, 5, 1], 3, async (ms) => {
      running += 1
      most = Math.max(most, running)
      await new Promise((resolve) => setTimeout(resolve, ms))
      running -= 1
      return ms * 2
    })
    expect(out).toEqual([60, 20, 40, 10, 2])
    expect(most).toBe(3)
  })

  it('answers late when the work hangs, and with the work when it is in time', async () => {
    expect(await orAfter(new Promise<string>(() => {}), 10, () => 'late')).toBe('late')
    expect(await orAfter(Promise.resolve('done'), 1_000, () => 'late')).toBe('done')
  })

  it('keeps late work pending until it ends, so the next pass waits for it', async () => {
    const late = createLateWork()
    let finish: (value: string) => void = () => {}
    const work = new Promise<string>((resolve) => (finish = resolve))
    expect(await late.orAfter(work, 10, () => 'late')).toBe('late')
    let settled = false
    const waiting = late.settled().then(() => (settled = true))
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(settled).toBe(false)
    finish('done')
    await waiting
    expect(settled).toBe(true)
  })
})

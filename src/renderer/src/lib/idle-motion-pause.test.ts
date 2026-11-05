import { describe, expect, it } from 'vitest'
import { installIdleMotionPause, type IdleMotionHost } from './idle-motion-pause'

type FakeAnimation = {
  animationName: string
  playState: AnimationPlayState
  effect: { getTiming(): { iterations: number } }
  pause(): void
  play(): void
}

function fakeAnimation(animationName: string, iterations: number): FakeAnimation {
  const animation: FakeAnimation = {
    animationName,
    playState: 'running',
    effect: { getTiming: () => ({ iterations }) },
    pause: () => {
      animation.playState = 'paused'
    },
    play: () => {
      animation.playState = 'running'
    }
  }
  return animation
}

function fakeHost(animations: FakeAnimation[]) {
  const listeners = new Map<string, () => void>()
  const state = { focused: true, setBattery: (_onBattery: boolean): void => {} }
  const dataset: DOMStringMap = {}
  const host: IdleMotionHost = {
    doc: {
      hasFocus: () => state.focused,
      addEventListener: (type: string, listener: () => void) => listeners.set(type, listener),
      removeEventListener: (type: string) => listeners.delete(type),
      documentElement: { dataset },
      getAnimations: () => animations
    },
    win: {
      addEventListener: (type: string, listener: () => void) => listeners.set(type, listener),
      removeEventListener: (type: string) => listeners.delete(type),
      setTimeout: (handler: () => void) => {
        handler()
        return 0
      }
    },
    readPowerSource: (onChange) => {
      state.setBattery = onChange
    }
  }
  const fire = (type: string): void => listeners.get(type)?.()
  return { host, state, dataset, fire, listeners }
}

describe('installIdleMotionPause', () => {
  it('holds endless loops while unfocused or on battery and keeps the agent spinner turning', async () => {
    const blink = fakeAnimation('hqp-blink', Infinity)
    const spinner = fakeAnimation('agent-spinner-rotate', Infinity)
    const unfold = fakeAnimation('hqp-unfold', 1)
    const animations = [blink, spinner, unfold]
    const { host, state, dataset, fire } = fakeHost(animations)
    const dispose = installIdleMotionPause(host)
    expect(dataset.motion).toBeUndefined()
    expect(blink.playState).toBe('running')

    state.focused = false
    fire('blur')
    expect(dataset.motion).toBe('held')
    expect(blink.playState).toBe('paused')
    expect(spinner.playState).toBe('running')
    expect(unfold.playState).toBe('running')

    const late = fakeAnimation('hqp-live-pulse', Infinity)
    animations.push(late)
    fire('animationstart')
    await Promise.resolve()
    expect(late.playState).toBe('paused')

    state.focused = true
    fire('focus')
    expect(dataset.motion).toBe('live')
    expect(blink.playState).toBe('running')
    expect(late.playState).toBe('running')

    state.setBattery(true)
    expect(blink.playState).toBe('paused')
    state.setBattery(false)
    expect(blink.playState).toBe('running')

    dispose()
  })

  it('leaves a loop someone else paused alone and resumes everything on dispose', () => {
    const blink = fakeAnimation('hqp-blink', Infinity)
    const stopped = fakeAnimation('hqp-drift', Infinity)
    stopped.playState = 'paused'
    const { host, state, fire, listeners } = fakeHost([blink, stopped])
    const dispose = installIdleMotionPause(host)
    state.focused = false
    fire('blur')
    expect(blink.playState).toBe('paused')

    dispose()
    expect(blink.playState).toBe('running')
    expect(stopped.playState).toBe('paused')
    expect(listeners.size).toBe(0)
  })
})

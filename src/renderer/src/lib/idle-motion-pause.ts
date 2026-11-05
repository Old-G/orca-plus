// Custom build (battery-idle): endless CSS loops hold still while nobody looks — the window lost focus
// or the Mac runs on battery. One loop keeps the compositor ticking for every other one, so all hold;
// the working-agent spinner keeps turning (12 steps a second, cheap) so a glance still shows work.
const KEEPS_RUNNING = new Set(['agent-spinner-rotate'])

type MotionAnimation = Pick<Animation, 'playState' | 'pause' | 'play'> & {
  effect: { getTiming(): { iterations?: number } } | null
  animationName?: string
}

export type IdleMotionHost = {
  doc: Pick<Document, 'hasFocus' | 'addEventListener' | 'removeEventListener'> & {
    documentElement: { dataset: DOMStringMap }
    getAnimations(): MotionAnimation[]
  }
  win: Pick<Window, 'addEventListener' | 'removeEventListener' | 'setTimeout'>
  readPowerSource?: (onChange: (onBattery: boolean) => void) => void
}

function isEndlessLoop(animation: MotionAnimation): boolean {
  if (animation.effect?.getTiming().iterations !== Infinity) {
    return false
  }
  return !(animation.animationName && KEEPS_RUNNING.has(animation.animationName))
}

// Chromium reports `charging` true on AC even at 100%, so it reads as "on external power".
function readBatteryPowerSource(onChange: (onBattery: boolean) => void): void {
  const getBattery: unknown = Reflect.get(navigator, 'getBattery')
  if (typeof getBattery !== 'function') {
    return
  }
  Promise.resolve(getBattery.call(navigator))
    .then((manager: unknown) => {
      if (!(manager instanceof EventTarget) || !('charging' in manager)) {
        return
      }
      const battery = manager
      const read = (): void => onChange(battery.charging === false)
      read()
      battery.addEventListener('chargingchange', read)
    })
    .catch(() => {})
}

export function installIdleMotionPause(host?: IdleMotionHost): () => void {
  const resolved: IdleMotionHost = host ?? {
    doc: document,
    win: window,
    readPowerSource: readBatteryPowerSource
  }
  const { doc, win, readPowerSource } = resolved
  const held = new WeakSet<MotionAnimation>()
  let focused = doc.hasFocus()
  let onBattery = false
  let holding = false
  let rescanQueued = false
  let disposed = false

  const holdRunningLoops = (): void => {
    for (const animation of doc.getAnimations()) {
      if (animation.playState === 'running' && isEndlessLoop(animation)) {
        animation.pause()
        held.add(animation)
      }
    }
  }
  const apply = (): void => {
    const next = !disposed && (!focused || onBattery)
    if (next === holding) {
      return
    }
    holding = next
    doc.documentElement.dataset.motion = next ? 'held' : 'live'
    if (next) {
      holdRunningLoops()
      return
    }
    for (const animation of doc.getAnimations()) {
      if (held.has(animation)) {
        held.delete(animation)
        animation.play()
      }
    }
  }
  // A loop that mounts while held (pseudo-elements included) is caught on its first frame.
  const onAnimationStart = (): void => {
    if (!holding || rescanQueued) {
      return
    }
    rescanQueued = true
    queueMicrotask(() => {
      rescanQueued = false
      if (holding) {
        holdRunningLoops()
      }
    })
  }
  const readFocus = (): void => {
    focused = doc.hasFocus()
    apply()
  }
  // Focus moving into an embedded guest (browser pane) blurs the window but keeps hasFocus().
  const onBlur = (): void => {
    win.setTimeout(readFocus, 0)
  }

  doc.addEventListener('animationstart', onAnimationStart, true)
  win.addEventListener('focus', readFocus)
  win.addEventListener('blur', onBlur)
  readPowerSource?.((battery) => {
    onBattery = battery
    apply()
  })
  apply()

  return () => {
    disposed = true
    apply()
    doc.removeEventListener('animationstart', onAnimationStart, true)
    win.removeEventListener('focus', readFocus)
    win.removeEventListener('blur', onBlur)
  }
}

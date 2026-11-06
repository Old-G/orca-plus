// Custom build (paper-theme): the theme's Auto modes live in main, which can see what the renderer
// cannot — the power source (powerMonitor) and the built-in screen's brightness (corebrightnessdiag) — and writes
// light or dark into the stock `theme` setting; the store sends the change to every window.
// «Auto: Paper on battery» follows the charger; «Auto: Paper at low brightness» polls the backlight
// while picked (owner 07.11: «нажимаю F1, уменьшаю яркость, а тема не переключается»).
// The pick is a per-device file in userData, so it survives restarts and can be set without the UI.
import { execFile } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { BrowserWindow, app, ipcMain, powerMonitor } from 'electron'

export type ThemeAutoMode = 'off' | 'battery' | 'brightness'
type Theme = 'system' | 'dark' | 'light'

export const THEME_AUTO_GET_CHANNEL = 'orcaPlusTheme:getAuto'
export const THEME_AUTO_SET_CHANNEL = 'orcaPlusTheme:setAuto'
export const THEME_AUTO_CHANGED_CHANNEL = 'orcaPlusTheme:autoChanged'

/** Paper at or below this share of the maximum brightness… */
export const PAPER_AT_OR_BELOW = 0.3
/** …and back to dark only from here, so a level near the line does not flicker. */
export const DARK_AT_OR_ABOVE = 0.38
export const BRIGHTNESS_POLL_MS = 4000

/** The built-in screen's brightness slider (what F1/F2 move) as 0..1, from `corebrightnessdiag
 *  status-info`; null when no built-in display reports one (an external monitor only, another Mac).
 *  Why not ioreg: AppleARMBacklight's "brightness" stays at its boot value (07.11, MBP M1 Pro). */
export function parseBuiltInBrightness(status: string): number | null {
  const marker = '<key>DisplayServicesBrightness</key>'
  const blocks = status.split(marker).slice(1)
  for (const block of blocks) {
    const value = /^\s*<real>([-+\d.eE]+)<\/real>/.exec(block)
    const builtIn = /<key>DisplayServicesIsBuiltInDisplay<\/key>\s*<true\/>/.test(block)
    if (value && builtIn) {
      const level = Number(value[1])
      return Number.isFinite(level) ? Math.min(1, Math.max(0, level)) : null
    }
  }
  return null
}

/** What the theme should become at this brightness; null keeps it (unknown level, or the band between). */
export function themeOnBrightness(level: number | null): 'light' | 'dark' | null {
  if (level === null) {
    return null
  }
  if (level <= PAPER_AT_OR_BELOW) {
    return 'light'
  }
  return level >= DARK_AT_OR_ABOVE ? 'dark' : null
}

export function themeOnPower(onBattery: boolean): 'light' | 'dark' {
  return onBattery ? 'light' : 'dark'
}

export function normalizeThemeAutoMode(value: unknown): ThemeAutoMode {
  return value === 'battery' || value === 'brightness' ? value : 'off'
}

type ThemeStore = {
  getSettings(): { theme: Theme }
  updateSettings(updates: { theme: Theme }, options: { notifyListeners: boolean }): unknown
}

type PowerSource = {
  on(event: 'on-battery' | 'on-ac', listener: () => void): unknown
  off(event: 'on-battery' | 'on-ac', listener: () => void): unknown
  isOnBatteryPower(): boolean
}

export type ThemeAutoDeps = {
  store: ThemeStore
  power: PowerSource
  readBrightness: () => Promise<number | null>
  readMode: () => ThemeAutoMode
  writeMode: (mode: ThemeAutoMode) => void
  notify: (mode: ThemeAutoMode) => void
  setInterval: (callback: () => void, ms: number) => unknown
  clearInterval: (handle: unknown) => void
}

export class ThemeAuto {
  private mode: ThemeAutoMode
  private stopCurrent: (() => void) | null = null

  constructor(private readonly deps: ThemeAutoDeps) {
    this.mode = deps.readMode()
  }

  getMode(): ThemeAutoMode {
    return this.mode
  }

  start(): void {
    this.run()
  }

  setMode(mode: ThemeAutoMode): void {
    this.mode = mode
    this.deps.writeMode(mode)
    this.deps.notify(mode)
    this.run()
  }

  stop(): void {
    this.stopCurrent?.()
    this.stopCurrent = null
  }

  /** One brightness reading → theme; exported for the poll and for tests. */
  async checkBrightness(): Promise<void> {
    if (this.mode !== 'brightness') {
      return
    }
    const next = themeOnBrightness(await this.deps.readBrightness().catch(() => null))
    if (this.mode === 'brightness') {
      this.apply(next)
    }
  }

  private apply(theme: 'light' | 'dark' | null): void {
    if (theme && this.deps.store.getSettings().theme !== theme) {
      // Why notify: without it the store saves the theme but no window repaints.
      this.deps.store.updateSettings({ theme }, { notifyListeners: true })
    }
  }

  private run(): void {
    this.stop()
    if (this.mode === 'battery') {
      const onBattery = (): void => this.apply(themeOnPower(true))
      const onAc = (): void => this.apply(themeOnPower(false))
      this.deps.power.on('on-battery', onBattery)
      this.deps.power.on('on-ac', onAc)
      this.apply(themeOnPower(this.deps.power.isOnBatteryPower()))
      this.stopCurrent = () => {
        this.deps.power.off('on-battery', onBattery)
        this.deps.power.off('on-ac', onAc)
      }
    } else if (this.mode === 'brightness') {
      const handle = this.deps.setInterval(() => void this.checkBrightness(), BRIGHTNESS_POLL_MS)
      void this.checkBrightness()
      this.stopCurrent = () => this.deps.clearInterval(handle)
    }
  }
}

function readBuiltInBrightness(): Promise<number | null> {
  if (process.platform !== 'darwin') {
    return Promise.resolve(null)
  }
  return new Promise((resolve) => {
    execFile(
      '/usr/libexec/corebrightnessdiag',
      ['status-info'],
      { timeout: 2000, maxBuffer: 1024 * 1024 },
      (error, stdout) => resolve(error ? null : parseBuiltInBrightness(stdout))
    )
  })
}

export function registerThemeAuto(store: ThemeStore): () => void {
  const file = join(app.getPath('userData'), 'orca-plus-theme-auto.json')
  const auto = new ThemeAuto({
    store,
    power: powerMonitor,
    readBrightness: readBuiltInBrightness,
    readMode: () => {
      try {
        return normalizeThemeAutoMode(JSON.parse(readFileSync(file, 'utf8')).mode)
      } catch {
        return 'off'
      }
    },
    writeMode: (mode) => {
      try {
        writeFileSync(file, `${JSON.stringify({ mode })}\n`)
      } catch (error) {
        console.warn('[theme-auto] could not save the mode:', error)
      }
    },
    notify: (mode) => {
      for (const window of BrowserWindow.getAllWindows()) {
        if (!window.isDestroyed()) {
          window.webContents.send(THEME_AUTO_CHANGED_CHANNEL, mode)
        }
      }
    },
    setInterval: (callback, ms) => setInterval(callback, ms),
    clearInterval: (handle) => clearInterval(handle as ReturnType<typeof setInterval>)
  })
  ipcMain.handle(THEME_AUTO_GET_CHANNEL, () => auto.getMode())
  ipcMain.handle(THEME_AUTO_SET_CHANNEL, (_event, mode: unknown) =>
    auto.setMode(normalizeThemeAutoMode(mode))
  )
  auto.start()
  return () => {
    auto.stop()
    ipcMain.removeHandler(THEME_AUTO_GET_CHANNEL)
    ipcMain.removeHandler(THEME_AUTO_SET_CHANNEL)
  }
}

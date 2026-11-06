// Custom build (paper-theme): the theme «Auto: Paper on battery» needs to know when the Mac leaves or
// returns to the charger. Renderers cannot see the power source, so main tells every window.
import { BrowserWindow, ipcMain, powerMonitor } from 'electron'

export const POWER_SOURCE_CHANGED_CHANNEL = 'orcaPlusPower:changed'
export const POWER_SOURCE_ON_BATTERY_CHANNEL = 'orcaPlusPower:isOnBattery'

export type PowerSourceChange = { onBattery: boolean }

type PowerSourceEvent = 'on-battery' | 'on-ac'

type PowerSource = {
  on(event: PowerSourceEvent, listener: () => void): unknown
  off(event: PowerSourceEvent, listener: () => void): unknown
  isOnBatteryPower(): boolean
}

type PowerSourceWindow = {
  isDestroyed(): boolean
  webContents: { send(channel: string, change: PowerSourceChange): void }
}

type PowerSourceIpc = {
  handle(channel: string, listener: () => boolean): void
  removeHandler(channel: string): void
}

export function registerPowerSourceBroadcast(
  options: {
    source?: PowerSource
    getWindows?: () => PowerSourceWindow[]
    ipc?: PowerSourceIpc
  } = {}
): () => void {
  const source = options.source ?? powerMonitor
  const getWindows = options.getWindows ?? (() => BrowserWindow.getAllWindows())
  const ipc = options.ipc ?? ipcMain

  const broadcast = (onBattery: boolean): void => {
    for (const window of getWindows()) {
      if (!window.isDestroyed()) {
        window.webContents.send(POWER_SOURCE_CHANGED_CHANNEL, { onBattery })
      }
    }
  }
  const onBattery = (): void => broadcast(true)
  const onAc = (): void => broadcast(false)

  source.on('on-battery', onBattery)
  source.on('on-ac', onAc)
  ipc.handle(POWER_SOURCE_ON_BATTERY_CHANNEL, () => source.isOnBatteryPower())
  return () => {
    source.off('on-battery', onBattery)
    source.off('on-ac', onAc)
    ipc.removeHandler(POWER_SOURCE_ON_BATTERY_CHANNEL)
  }
}

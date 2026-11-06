import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => [] },
  ipcMain: { handle: vi.fn(), removeHandler: vi.fn() },
  powerMonitor: { on: vi.fn(), off: vi.fn(), isOnBatteryPower: () => false }
}))

import {
  POWER_SOURCE_CHANGED_CHANNEL,
  POWER_SOURCE_ON_BATTERY_CHANNEL,
  registerPowerSourceBroadcast
} from './power-source-broadcast'

function fakeSource(onBatteryNow: boolean) {
  const listeners = new Map<string, () => void>()
  return {
    listeners,
    on: (event: string, listener: () => void) => listeners.set(event, listener),
    off: (event: string) => listeners.delete(event),
    isOnBatteryPower: () => onBatteryNow
  }
}

function fakeIpc() {
  const handlers = new Map<string, () => boolean>()
  return {
    handlers,
    handle: (channel: string, listener: () => boolean) => handlers.set(channel, listener),
    removeHandler: (channel: string) => handlers.delete(channel)
  }
}

describe('registerPowerSourceBroadcast', () => {
  it('tells every open window when the Mac leaves and returns to the charger', () => {
    const source = fakeSource(false)
    const open = { isDestroyed: () => false, webContents: { send: vi.fn() } }
    const closed = { isDestroyed: () => true, webContents: { send: vi.fn() } }
    registerPowerSourceBroadcast({ source, getWindows: () => [open, closed], ipc: fakeIpc() })

    source.listeners.get('on-battery')?.()
    source.listeners.get('on-ac')?.()

    expect(open.webContents.send.mock.calls).toEqual([
      [POWER_SOURCE_CHANGED_CHANNEL, { onBattery: true }],
      [POWER_SOURCE_CHANGED_CHANNEL, { onBattery: false }]
    ])
    expect(closed.webContents.send).not.toHaveBeenCalled()
  })

  it('answers the current power source and lets go of everything on stop', () => {
    const source = fakeSource(true)
    const ipc = fakeIpc()
    const stop = registerPowerSourceBroadcast({ source, getWindows: () => [], ipc })

    expect(ipc.handlers.get(POWER_SOURCE_ON_BATTERY_CHANNEL)?.()).toBe(true)

    stop()
    expect(source.listeners.size).toBe(0)
    expect(ipc.handlers.size).toBe(0)
  })
})

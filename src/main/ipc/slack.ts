import { ipcMain } from 'electron'
import type { SlackConnectResult, SlackMutationResult } from '../../shared/slack-types'
import {
  connectSlack,
  disconnectSlack,
  getSlackStatus,
  sendSlackTestMessage,
  setSlackTarget
} from '../slack/slack-client'

function readArgs(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? Object.fromEntries(Object.entries(value)) : {}
}

function readText(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/** Registers every `slack:*` IPC handler on the main process. */
export function registerSlackHandlers(): void {
  ipcMain.handle('slack:connect', async (_event, args: unknown): Promise<SlackConnectResult> => {
    const input = readArgs(args)
    return connectSlack({
      botToken: readText(input.botToken),
      appToken: readText(input.appToken),
      ownerId: readText(input.ownerId)
    })
  })

  ipcMain.handle('slack:disconnect', async () => disconnectSlack())

  ipcMain.handle('slack:status', async () => getSlackStatus())

  ipcMain.handle('slack:sendTest', async () => sendSlackTestMessage())

  ipcMain.handle('slack:setTarget', async (_event, args: unknown): Promise<SlackMutationResult> => {
    const input = readArgs(args)
    return input.kind === 'channel'
      ? setSlackTarget({ kind: 'channel', channel: readText(input.channel) })
      : setSlackTarget({ kind: 'dm' })
  })
}

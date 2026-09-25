import { ipcMain } from 'electron'
import type { Store } from '../persistence'
import type { OrcaRuntimeService } from '../runtime/orca-runtime'
import type { SlackConnectResult, SlackMutationResult } from '../../shared/slack-types'
import {
  connectSlack,
  disconnectSlack,
  getSlackStatus,
  sendSlackTestMessage,
  setSlackTarget
} from '../slack/slack-client'
import { getSlackSocketService, installSlackSocketService } from '../slack/slack-socket-service'

function readArgs(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? Object.fromEntries(Object.entries(value)) : {}
}

function readText(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/** Registers every `slack:*` IPC handler and starts Socket Mode when Slack is connected. */
export function registerSlackHandlers(store: Store, runtime: OrcaRuntimeService): void {
  installSlackSocketService(store, runtime)

  ipcMain.handle('slack:connect', async (_event, args: unknown): Promise<SlackConnectResult> => {
    const input = readArgs(args)
    const result = await connectSlack({
      botToken: readText(input.botToken),
      appToken: readText(input.appToken),
      ownerId: readText(input.ownerId)
    })
    if (result.ok) {
      getSlackSocketService()?.restart()
    }
    return result
  })

  ipcMain.handle('slack:disconnect', async () => {
    getSlackSocketService()?.stop()
    disconnectSlack()
  })

  ipcMain.handle('slack:status', async () => getSlackStatus())

  ipcMain.handle('slack:sendTest', async () => sendSlackTestMessage())

  ipcMain.handle('slack:setTarget', async (_event, args: unknown): Promise<SlackMutationResult> => {
    const input = readArgs(args)
    return input.kind === 'channel'
      ? setSlackTarget({ kind: 'channel', channel: readText(input.channel) })
      : setSlackTarget({ kind: 'dm' })
  })
}

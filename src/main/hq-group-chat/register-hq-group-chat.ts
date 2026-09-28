// Custom build (hq-group-chat): IPC for the group menu's "Group chat".
import { existsSync } from 'node:fs'
import { ipcMain } from 'electron'
import type { Store } from '../persistence'
import type { HqRosterSync } from '../hq-roster-sync/hq-roster-sync'
import { runProcess } from '../../shared/child-process/run-process'
import type { HqGroupChatResult } from '../../shared/hq-group-chat'
import { createHqGroupChat } from './hq-group-chat'

const SCRIPT_TIMEOUT_MS = 30_000

export function registerHqGroupChatHandlers(store: Store, rosterSync: HqRosterSync): void {
  const groupChat = createHqGroupChat({
    hqPath: () => store.getSettings().hqPath ?? null,
    fileExists: existsSync,
    run: async (program, args, cwd) => {
      const result = await runProcess({ program, args, cwd, timeoutMs: SCRIPT_TIMEOUT_MS })
      return { code: result.code, stdout: result.stdout, stderr: result.stderr }
    },
    platform: process.platform,
    refreshRegistry: () => rosterSync.syncNow()
  })

  ipcMain.handle(
    'hqGroupChat:prepare',
    async (_event, groupId: unknown): Promise<HqGroupChatResult> => {
      // Why: only the id comes from the renderer; the name and host are read from the store.
      const group =
        typeof groupId === 'string'
          ? store.getProjectGroups().find((entry) => entry.id === groupId)
          : undefined
      if (!group) {
        return { ok: false, error: 'This group no longer exists.' }
      }
      return groupChat.prepare(group)
    }
  )
}

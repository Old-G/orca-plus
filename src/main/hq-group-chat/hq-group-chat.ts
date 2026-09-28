// Custom build (hq-group-chat): prepares a group's chat folder by running HQ's hq_group_chat.py.
// The script owns what goes into chats/<group>/; Orca only asks for it and opens the result.
import { join } from 'node:path'
import type { HqCommandResult } from '../hq-roster-sync/hq-roster-sync'
import type { ProjectGroup } from '../../shared/project-group-types'
import { readHqGroupChatPath, type HqGroupChatResult } from '../../shared/hq-group-chat'

export type HqGroupChatDeps = {
  hqPath: () => string | null
  fileExists: (path: string) => boolean
  run: (program: string, args: readonly string[], cwd: string) => Promise<HqCommandResult>
  platform: NodeJS.Platform
  /** Re-reads Orca's groups into HQ's registry; group edits alone do not trigger a roster sync. */
  refreshRegistry: () => Promise<unknown>
}

// hq_group_chat.py exit code for a group none of whose projects is in registry.yaml.
const EXIT_NO_SUCH_GROUP = 4

export function createHqGroupChat(deps: HqGroupChatDeps) {
  const python = deps.platform === 'win32' ? 'python' : 'python3'
  return {
    async prepare(group: ProjectGroup): Promise<HqGroupChatResult> {
      const hq = deps.hqPath()?.trim()
      if (!hq) {
        return { ok: false, error: 'Set the HQ folder in Settings → General → Workspace first.' }
      }
      // Why: HQ lives on this machine, and so do the links the script makes.
      if (group.connectionId) {
        return { ok: false, error: 'Group chats cover groups on this computer only.' }
      }
      const script = join(hq, 'scripts', 'hq_group_chat.py')
      if (!deps.fileExists(script)) {
        return {
          ok: false,
          error: `${script} is missing. Copy it from strata-hq 0.3.0 or later.`
        }
      }
      const args = [script, '--hq', hq, '--group-id', group.id, '--group', group.name]
      let result = await deps.run(python, args, hq)
      if (result.code === EXIT_NO_SUCH_GROUP) {
        await deps.refreshRegistry()
        result = await deps.run(python, args, hq)
      }
      if (result.code === EXIT_NO_SUCH_GROUP) {
        return { ok: false, error: `HQ's registry has no project of ${group.name}.` }
      }
      const path = result.code === 0 ? readHqGroupChatPath(result.stdout) : null
      if (!path) {
        return {
          ok: false,
          error: result.stderr.trim() || `hq_group_chat.py exited ${String(result.code)}`
        }
      }
      return { ok: true, path }
    }
  }
}

// Custom build (chat-auto-effort): the setting and the classifier, bound at startup.
import { homedir } from 'node:os'
import { ipcMain } from 'electron'
import type { Store } from '../../persistence/loading-store/store'
import type { CommitMessageAgentEnvironmentResolvers } from '../../text-generation/execution/commit-message-agent-environment'
import { generateHqText } from '../../hq-today/hq-task-questions'
import { createHaikuEffortPick } from './haiku-effort-pick'
import { createChatRoleOf } from './lead-plan-registry'
import { provideNativeChatAutoEffort, recentAutoEffortOutcomes } from './native-chat-auto-effort'
import type { ChatAutoEffortStatus } from '../../../shared/chat-auto-effort-status'

export function registerNativeChatAutoEffort(
  store: Store,
  getAgentEnvResolvers: () => CommitMessageAgentEnvironmentResolvers | undefined
): void {
  provideNativeChatAutoEffort({
    enabled: () => store.getSettings().nativeChatAutoEffort === true,
    pick: createHaikuEffortPick((prompt) =>
      generateHqText(
        prompt,
        { emptyResultName: 'effort', operation: 'hq-effort-pick', model: 'haiku' },
        {
          settings: store.getSettings(),
          cwd: store.getSettings().hqPath ?? homedir(),
          getAgentEnvResolvers
        }
      )
    ),
    roleOf: createChatRoleOf({ hqPath: () => store.getSettings().hqPath })
  })
  // Why the old name: the channel is what Settings asks for the recent picks.
  ipcMain.handle('hqProjects:autoEffortKeyStatus', (): ChatAutoEffortStatus => ({
    recent: recentAutoEffortOutcomes()
  }))
}

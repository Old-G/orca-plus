// Custom build (hq-router two marks): what starting a chat for a 🆕 mark needs from Orca+.
import { getRepoMainWorktreeId } from '../../shared/worktree/id'
import type { Store } from '../persistence/loading-store/store'
import type { OrcaRuntimeService } from '../runtime/orca-runtime'
import { deliverToNativeChat } from '../orca-plus/waiting-replies/deliver-waiting-reply'
import { launchHqBackgroundChat, limitHqChatToAuto } from './hq-background-chat'
import { hqIntakeCloseRoute } from './hq-intake-close-route'
import type { HqNewMarkChatDeps } from './hq-new-mark-chat'

/** The project's workspace (HQ's own when none), a background chat, and the thread binding. */
export function newMarkChatDeps(store: Store, runtime: OrcaRuntimeService): HqNewMarkChatDeps {
  return {
    workspaceFor: (repoId) => {
      const hq = store.getSettings().hqPath
      const repo = repoId
        ? store.getRepo(repoId)
        : store.getRepos().find((entry) => !!hq && entry.path === hq)
      return repo ? { worktreeId: getRepoMainWorktreeId(repo), name: repo.displayName } : null
    },
    launch: (worktreeId) => launchHqBackgroundChat(runtime, { kind: 'existing', worktreeId }),
    limit: (sessionId) => limitHqChatToAuto(sessionId, 'hq-router'),
    deliver: (sessionId, prompt) => deliverToNativeChat(sessionId, prompt, 'hq-router'),
    bind: (card, sessionId) => {
      const router = runtime.pulseRouter()
      hqIntakeCloseRoute(card, sessionId, {
        setConversationChat: (key, chat) => runtime.pulseSetConversationChat(key, chat),
        bindChoice: (input) => router.bindChoice(input),
        logChoice: (key, chat, at) => router.logChoice(key, chat, at),
        now: Date.now()
      })
    }
  }
}

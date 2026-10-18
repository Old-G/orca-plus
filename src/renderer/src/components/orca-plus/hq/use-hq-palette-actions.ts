// Custom build (hq-chats): HQ in the ⌘J palette — open HQ, switch back to Code, and every native chat
// by name, opened in HQ.
import { useMemo } from 'react'
import { Code2, LayoutDashboard, MessagesSquare } from 'lucide-react'
import type { CmdJQuickAction } from '@/components/cmd-j/quick-actions'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import { getStructuredAgentSessionTabs } from '../../native-chat/structured-agent-session-tabs'
import { resolveAgentSessionTabTitle } from '../../tab-bar/tab-bar-item-model'
import { switchHqToCode } from './hq-chat-actions'
import { openHqChat } from './hq-chat-open'
import { hqChatKey } from './hq-chat-list'
import { openHqScreen } from './hq-view'

const ALWAYS = (): { available: true } => ({ available: true })

export function useHqPaletteActions(): CmdJQuickAction[] {
  const inHq = useAppStore((state) => state.activeView === 'hq')
  const unifiedTabsByWorktree = useAppStore((state) => state.unifiedTabsByWorktree)
  const repos = useAppStore((state) => state.repos)
  const generatedTitles = useAppStore((state) => state.settings?.tabAutoGenerateTitle === true)
  return useMemo(() => {
    const state = useAppStore.getState()
    const repoNames = new Map(repos.map((repo) => [repo.id, repo.displayName]))
    const actions: CmdJQuickAction[] = [
      {
        id: 'hq:open',
        kind: 'action',
        title: translate('auto.hq.palette.open', 'Open HQ'),
        description: translate('auto.hq.palette.openHint', 'Agent chats, the day, waitings'),
        icon: LayoutDashboard,
        verbKeywords: ['hq', 'headquarters', 'chats', 'open hq'],
        isAvailable: ALWAYS,
        run: async () => {
          openHqScreen('chats')
          return { status: 'ok' }
        }
      }
    ]
    if (inHq) {
      actions.push({
        id: 'hq:code',
        kind: 'action',
        title: translate('auto.hq.palette.code', 'Switch to Code'),
        description: translate('auto.hq.palette.codeHint', "The open chat's project"),
        icon: Code2,
        verbKeywords: ['code', 'code mode', 'open project'],
        isAvailable: ALWAYS,
        run: async () => {
          switchHqToCode()
          return { status: 'ok' }
        }
      })
    }
    for (const tab of getStructuredAgentSessionTabs(unifiedTabsByWorktree)) {
      const worktree = state.getKnownWorktreeById(tab.worktreeId)
      if (!worktree) {
        continue
      }
      const title = resolveAgentSessionTabTitle(tab, null, generatedTitles)
      const project = repoNames.get(worktree.repoId) ?? worktree.displayName
      actions.push({
        id: `hq-chat:${hqChatKey(tab.worktreeId, tab.id)}`,
        kind: 'action',
        title: translate('auto.hq.palette.chat', 'Chat: {{value0}}', { value0: title }),
        description: `${project} · ${worktree.displayName}`,
        icon: MessagesSquare,
        verbKeywords: [title, project, 'chat'],
        isAvailable: ALWAYS,
        run: async () => {
          openHqChat(hqChatKey(tab.worktreeId, tab.id))
          return { status: 'ok' }
        }
      })
    }
    return actions
  }, [generatedTitles, inHq, repos, unifiedTabsByWorktree])
}

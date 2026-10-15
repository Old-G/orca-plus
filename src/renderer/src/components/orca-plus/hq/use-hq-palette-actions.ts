// Custom build (hq-chats): HQ in the ⌘J palette — open HQ, switch back to Code, and every native chat
// by name: under «New view» it opens in HQ, otherwise in its project.
import { useMemo } from 'react'
import { Code2, LayoutDashboard, MessagesSquare } from 'lucide-react'
import type { CmdJQuickAction } from '@/components/cmd-j/quick-actions'
import { translate } from '@/i18n/i18n'
import { useOrcaPlusNewView } from '@/lib/orca-plus-new-view'
import { activateStructuredAgentSessionTab } from '@/lib/structured-agent-session-tab-activation'
import { activateAndRevealWorkspace } from '@/lib/worktree-activation'
import { useAppStore } from '@/store'
import type { Tab } from '../../../../../shared/tab-types'
import { getStructuredAgentSessionTabs } from '../../native-chat/structured-agent-session-tabs'
import { resolveAgentSessionTabTitle } from '../../tab-bar/tab-bar-item-model'
import { switchHqToCode } from './hq-chat-actions'
import { openHqChat } from './hq-chat-open'
import { hqChatKey } from './hq-chat-list'
import { openHqScreen } from './hq-view'

const ALWAYS = (): { available: true } => ({ available: true })

function openChatInProject(tab: Tab): void {
  if (activateAndRevealWorkspace(tab.worktreeId) !== false) {
    activateStructuredAgentSessionTab({ worktreeId: tab.worktreeId, tabId: tab.id })
  }
}

export function useHqPaletteActions(): CmdJQuickAction[] {
  const newView = useOrcaPlusNewView()
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
    if (newView && inHq) {
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
          if (newView) {
            openHqChat(hqChatKey(tab.worktreeId, tab.id))
          } else {
            openChatInProject(tab)
          }
          return { status: 'ok' }
        }
      })
    }
    return actions
  }, [generatedTitles, inHq, newView, repos, unifiedTabsByWorktree])
}

// Custom build (hq-mobile-messenger): the desktop's HQ chat list, slimmed for the phone, in the
// sections HQ's messenger shows them.
import type { HqChatWireItem } from '../../../../../shared/hq-chat-wire'
import { structuredAgentSessionPaneKey } from '../../../../../shared/structured-agent-session-projection'
import { formatAgentTypeLabel } from '@/lib/agent-status'
import { resolveAgentSessionTabTitle } from '../../tab-bar/tab-bar-item-model'
import type { HqActiveProject } from './hq-active-projects'
import { hqChatSessionId } from './hq-chat-cleanup'
import type { HqChatItem } from './hq-chat-list'

const PREVIEW_MAX = 400

function title(item: HqChatItem, generatedTitles: boolean): string {
  if (item.kind === 'chat') {
    return resolveAgentSessionTabTitle(item.tab, null, generatedTitles)
  }
  return item.card.conversationName ?? formatAgentTypeLabel(item.agentType)
}

function preview(item: HqChatItem): string {
  const card = item.card
  if (item.group === 'needs') {
    return card?.askSummary ?? 'Waiting for you'
  }
  return card?.lastAgentMessage ?? card?.lastUserMessage ?? (card?.task || item.worktreeName)
}

function paneKey(item: HqChatItem): string | null {
  if (item.card?.paneKey) {
    return item.card.paneKey
  }
  return item.kind === 'chat' ? structuredAgentSessionPaneKey(item.tab.id, item.tab.entityId) : null
}

export function buildHqChatWire(
  groups: { needs: HqChatItem[]; working: HqChatItem[]; done: HqChatItem[]; quiet: HqChatItem[] },
  active: readonly HqActiveProject[],
  colorFor: (projectId: string) => string,
  generatedTitles: boolean
): HqChatWireItem[] {
  const wire = (item: HqChatItem, group: HqChatWireItem['group']): HqChatWireItem => ({
    key: item.key,
    group,
    worktreeId: item.worktreeId,
    paneKey: paneKey(item),
    executionHostId:
      item.card?.executionHostId ??
      (item.kind === 'chat' ? item.tab.executionHostId : null) ??
      null,
    projectName: item.projectName,
    repoId: item.repoId,
    worktreeName: item.worktreeName,
    title: title(item, generatedTitles).slice(0, 300),
    preview: preview(item).replace(/\s+/g, ' ').trim().slice(0, PREVIEW_MAX),
    agentType: item.agentType,
    unseen: item.card?.unseen === true,
    sortAt: item.sortAt,
    color: colorFor(item.repoId),
    sessionId: item.kind === 'chat' ? hqChatSessionId(item.tab.id) : null
  })
  return [
    ...groups.needs.map((item) => wire(item, 'needs')),
    ...groups.working.map((item) => wire(item, 'working')),
    ...groups.done.map((item) => wire(item, 'done')),
    ...active.flatMap((project) => project.items.map((item) => wire(item, 'active'))),
    ...groups.quiet.slice(0, 60).map((item) => wire(item, 'quiet'))
  ]
}

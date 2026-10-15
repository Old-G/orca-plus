// Custom build (hq-agent-map): «Agent map» — a native chat's agent and the subagents it spawned, each
// under its spawner, with state, time and tokens. Opened from the chat's header in HQ and from the
// subagent line of its context panel.
import { Network } from 'lucide-react'
import { AgentStateDot } from '@/components/AgentStateDot'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { translate } from '@/i18n/i18n'
import {
  formatSubagentTokens,
  subagentStateLabel
} from '../../../../../shared/native-chat-subagent-group-header'
import { normalizeSubagentState } from '../../../../../shared/native-chat-subagent-summary'
import { StatusDot, SubagentElapsed } from '../../native-chat/NativeChatSubagentRun'
import { sayNativeChatSubagentGroupTranslated as say } from '../../native-chat/native-chat-subagent-group-words-text'
import type { HqAgentMap, HqAgentMapNode } from './hq-agent-map'
import type { HqChatItem } from './hq-chat-list'
import { useHqChatTitle } from './HqChatAvatar'
import { useHqAgentMap } from './use-hq-agent-map'

const INDENT_PX = 14

function AgentRow({ node, depth }: { node: HqAgentMapNode; depth: number }): React.JSX.Element {
  const { entry, children } = node
  const state = normalizeSubagentState(entry.state)
  return (
    <li>
      <div className="flex items-center gap-1.5 py-0.5" style={{ paddingLeft: depth * INDENT_PX }}>
        <StatusDot state={state} pulsing={state === 'working'} />
        <span className="min-w-0 flex-1 truncate text-xs">{entry.label}</span>
        <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
          {subagentStateLabel(state, 1, 1, say)}
          {entry.startedAt !== undefined ? (
            <>
              {' · '}
              <SubagentElapsed
                startedAt={entry.startedAt}
                settledAt={entry.settledAt ?? null}
                counting={state === 'working'}
              />
            </>
          ) : null}
          {typeof entry.tokens === 'number' ? ` · ${formatSubagentTokens(entry.tokens)}` : null}
        </span>
      </div>
      {children.length > 0 ? (
        <ul>
          {children.map((child) => (
            <AgentRow key={child.entry.id} node={child} depth={depth + 1} />
          ))}
        </ul>
      ) : null}
    </li>
  )
}

function summary(map: HqAgentMap): string {
  return map.working > 0
    ? translate('auto.hq.agentMap.summaryWorking', '{{total}} subagents, {{working}} working', {
        total: map.total,
        working: map.working
      })
    : translate('auto.hq.agentMap.summary', '{{total}} subagents', { total: map.total })
}

function MapContent({ item, map }: { item: HqChatItem; map: HqAgentMap }): React.JSX.Element {
  const title = useHqChatTitle(item)
  return (
    <PopoverContent align="end" sideOffset={6} className="w-96">
      <div className="p-3">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h3 className="text-xs font-semibold">
            {translate('auto.hq.agentMap.title', 'Agent map')}
          </h3>
          <span className="text-[11px] text-muted-foreground">{summary(map)}</span>
        </div>
        <ul className="scrollbar-sleek max-h-96 overflow-y-auto">
          <li>
            <div className="flex items-center gap-1.5 py-0.5">
              <AgentStateDot state={item.displayState} title={null} />
              <span className="min-w-0 flex-1 truncate text-xs font-semibold">{title}</span>
            </div>
            <ul>
              {map.roots.map((node) => (
                <AgentRow key={node.entry.id} node={node} depth={1} />
              ))}
            </ul>
          </li>
        </ul>
      </div>
    </PopoverContent>
  )
}

/** The header's «Agent map» button; nothing for a chat with no subagents. */
export function HqAgentMapButton({ item }: { item: HqChatItem }): React.JSX.Element | null {
  const map = useHqAgentMap(item)
  if (map.total === 0) {
    return null
  }
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button type="button" variant="ghost" size="xs" title={summary(map)}>
          <Network className="size-3" />
          {translate('auto.hq.agentMap.title', 'Agent map')}
          <span className="tabular-nums text-muted-foreground">{map.total}</span>
        </Button>
      </PopoverTrigger>
      <MapContent item={item} map={map} />
    </Popover>
  )
}

/** The context panel's subagent section under its `heading`, opening the same map; nothing for
 *  a chat with no subagents. */
export function HqAgentMapSection({
  item,
  heading
}: {
  item: HqChatItem
  heading: React.ReactNode
}): React.JSX.Element | null {
  const map = useHqAgentMap(item)
  if (map.total === 0) {
    return null
  }
  return (
    <section>
      {heading}
      <Popover>
        <PopoverTrigger asChild>
          <Button type="button" variant="ghost" size="xs">
            <Network className="size-3" />
            {summary(map)}
          </Button>
        </PopoverTrigger>
        <MapContent item={item} map={map} />
      </Popover>
    </section>
  )
}

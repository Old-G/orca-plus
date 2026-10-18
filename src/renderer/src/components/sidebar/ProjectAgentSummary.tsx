// Custom build (sidebar-summary): a project's agents at a glance on its sidebar header — how many
// wait for the user, work, and finished unread — under Orca+'s «New view» only.
import { AgentStateDot } from '@/components/AgentStateDot'
import { translate } from '@/i18n/i18n'
import { useProjectAgentCounts } from './project-agent-counts'

function Count({
  state,
  count,
  label
}: {
  state: 'waiting' | 'working' | 'done'
  count: number
  label: string
}): React.JSX.Element | null {
  if (count === 0) {
    return null
  }
  return (
    <span aria-label={label} className="inline-flex items-center gap-0.5 tabular-nums">
      <AgentStateDot state={state} title={null} />
      {count}
    </span>
  )
}

export function ProjectAgentSummary({
  projectId
}: {
  projectId: string
}): React.JSX.Element | null {
  const counts = useProjectAgentCounts(projectId)
  if (!counts || counts.attention + counts.working + counts.done === 0) {
    return null
  }
  return (
    <span className="ml-auto flex shrink-0 items-center gap-1.5 pl-1 text-[11px] text-muted-foreground">
      <Count
        state="waiting"
        count={counts.attention}
        label={translate('auto.sidebar.summary.needs', '{{count}} need you', {
          count: counts.attention
        })}
      />
      <Count
        state="working"
        count={counts.working}
        label={translate('auto.sidebar.summary.working', '{{count}} working', {
          count: counts.working
        })}
      />
      <Count
        state="done"
        count={counts.done}
        label={translate('auto.sidebar.summary.done', '{{count}} done, unread', {
          count: counts.done
        })}
      />
    </span>
  )
}

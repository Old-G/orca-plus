// Custom build (hq): the HQ «Agents» tab — sessions deferred with their work unfinished, then the
// agent board, acting on this window's own store.
import { useCallback } from 'react'
import { useNow } from '@/hooks/use-now'
import { useAppStore } from '@/store'
import { AgentKanbanBoard } from '../../dashboard-popout/AgentKanbanBoard'
import type { AgentRevealArgs } from '../../dashboard-popout/AgentTerminalDialog'
import { revealDashboardAgent } from '../../dashboard/reveal-dashboard-agent'
import { useLiveDashboardSnapshot } from '../../dashboard/useLiveDashboardSnapshot'
import { HqDeferredStrip } from './HqDeferredStrip'
import { useHqDeferredSessions } from './use-hq-deferred-sessions'

const AGE_TICK_MS = 60_000

export function HqAgentsTab(): React.JSX.Element {
  const snapshot = useLiveDashboardSnapshot()
  const deferred = useHqDeferredSessions(snapshot.cards)
  const now = useNow(AGE_TICK_MS)
  // Why: the board's default handlers are the pop-out's IPC relay, which main refuses from here.
  const handleAckAgent = useCallback((paneKey: string) => {
    useAppStore.getState().acknowledgeAgents([paneKey])
  }, [])
  const handleRevealAgent = useCallback((args: AgentRevealArgs) => revealDashboardAgent(args), [])
  return (
    <div className="flex h-full w-full flex-col">
      <HqDeferredStrip sessions={deferred.sessions} now={now} onClose={deferred.close} />
      <div className="min-h-0 flex-1">
        <AgentKanbanBoard
          snapshot={snapshot}
          containerClassName="h-full w-full bg-transparent"
          onAckAgent={handleAckAgent}
          onRevealAgent={handleRevealAgent}
        />
      </div>
    </div>
  )
}

// Custom build (hq-lead-handover, T2): what the sweep's Lead handover reads and does in the running app —
// the plans' Lead lines, who launched a chat, `orca hq reassign`, and closing a chat's tab.
import type { OrcaRuntimeService } from '../runtime/orca-runtime'
import { closeHqNativeChat } from '../ipc/claude-handoff'
import { hqReadPlanLeadRefs } from '../hq-journal/hq-lead-plan-line'
import { getHqLeadReassign } from '../hq-journal/hq-lead-reassign'
import type { HqSessionsDeps } from './hq-session-journal'

export function hqLeadHandoverDeps(
  runtime: OrcaRuntimeService,
  hqPath: () => string | null
): Pick<HqSessionsDeps, 'planLeads' | 'launchedBy' | 'reassignLead' | 'closeChat'> {
  return {
    planLeads: async () => {
      const hq = hqPath()
      return hq ? hqReadPlanLeadRefs(hq) : []
    },
    launchedBy: (sessionId) =>
      runtime
        .pulseChats()
        .list()
        .links.find((link) => link.sessionId === sessionId && link.via === 'launch')
        ?.parentSessionId ?? null,
    reassignLead: async (from, to) => {
      const reassign = getHqLeadReassign()
      if (!reassign) {
        return { ok: false, error: 'Lead handover is not available on this host.' }
      }
      try {
        const result = await reassign.reassign({ cwd: hqPath() }, { from, to })
        return { ok: true, moved: result.moved.length }
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) }
      }
    },
    closeChat: async (sessionId, worktreeId) => {
      if (!worktreeId) {
        return false
      }
      await closeHqNativeChat(runtime, sessionId, worktreeId)
      return true
    }
  }
}

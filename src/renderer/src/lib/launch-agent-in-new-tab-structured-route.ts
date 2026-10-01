import {
  adoptAgentSessionLaunchVerdict,
  type AgentSessionLaunchPlan
} from '@/lib/agent-session-launch-plan'
import type { AgentLaunchSurface, LaunchAgentInNewTabArgs } from '@/lib/launch-agent-in-new-tab'
import { launchAgentInStructuredNewTab } from '@/lib/launch-agent-in-new-tab-structured'
import type { StructuredAgentLaunchSettlement } from '@/lib/structured-agent-launch-settlement'
import type { StructuredPromptDeliveryResult } from '@/lib/structured-agent-session-launch-prompt'
import { rememberClaudeSubscriptionForSession } from '@/lib/claude-subscription-choice'
import {
  beginStructuredAgentSessionProvisionalLaunch,
  structuredLaunchPairedOwner
} from '@/lib/structured-agent-session-provisional-tab'

type StructuredFromNewTab = {
  surface: AgentLaunchSurface
  pasteDraftAfterLaunch: false
  structuredSettlement: Promise<StructuredAgentLaunchSettlement>
  promptDeliveryResult?: Promise<StructuredPromptDeliveryResult>
}

/**
 * The new-tab launcher's structured route. A local chat opens at once. A paired server admits the
 * chat before any of it exists here, so its surface is the host's, as for every paired launch, and
 * its "no" runs the caller's own launch as a terminal.
 */
export function launchStructuredAgentFromNewTab(args: {
  plan: AgentSessionLaunchPlan
  worktreeId: string
  groupId?: string
  beforeSurfaceOpen?: LaunchAgentInNewTabArgs['beforeSurfaceOpen']
  /** Custom build (claude-subscriptions): a local Claude chat's picked subscription. */
  claudeSubscriptionId?: string
  openTerminal: (terminalPlan: AgentSessionLaunchPlan) => {
    promptDeliveryResult?: Promise<StructuredPromptDeliveryResult>
  } | null
}): StructuredFromNewTab | null {
  const { plan, beforeSurfaceOpen, claudeSubscriptionId } = args
  const paired = structuredLaunchPairedOwner(plan, args.worktreeId)
  if (!paired) {
    const structured = launchAgentInStructuredNewTab({
      plan,
      ...(beforeSurfaceOpen || claudeSubscriptionId
        ? {
            beforeOpen: (sessionId?: string) => {
              // Before the create can run, so the host resolves this chat's home from the pick.
              if (sessionId !== undefined && claudeSubscriptionId) {
                rememberClaudeSubscriptionForSession(sessionId, claudeSubscriptionId)
              }
              return (
                sessionId === undefined ||
                beforeSurfaceOpen?.({ kind: 'local-agent-session', sessionId }) !== false
              )
            }
          }
        : {}),
      ...(args.groupId ? { targetGroupId: args.groupId } : {})
    })
    return (
      structured && {
        surface: {
          kind: 'local-agent-session',
          tabId: structured.tabId,
          sessionId: structured.sessionId
        },
        pasteDraftAfterLaunch: false,
        structuredSettlement: structured.structuredSettlement,
        ...(structured.promptDeliveryResult
          ? { promptDeliveryResult: structured.promptDeliveryResult }
          : {})
      }
    )
  }
  if (beforeSurfaceOpen?.({ kind: 'host-published' }) === false) {
    return null
  }
  const launch = beginStructuredAgentSessionProvisionalLaunch({
    plan,
    hooks: {},
    target: { worktreeId: args.worktreeId, executionHostId: paired.executionHostId },
    ...(args.groupId ? { targetGroupId: args.groupId } : {}),
    onHostDeclined: () => {
      const terminal = args.openTerminal(
        adoptAgentSessionLaunchVerdict({
          route: 'terminal-tui',
          requestId: plan.requestId,
          agent: plan.agent,
          worktreeId: args.worktreeId
        })
      )
      return {
        opened: terminal !== null,
        ...(terminal?.promptDeliveryResult
          ? { promptDeliveryResult: terminal.promptDeliveryResult }
          : {})
      }
    }
  })
  return (
    launch && {
      surface: { kind: 'host-published' },
      pasteDraftAfterLaunch: false,
      structuredSettlement: launch.settlement,
      ...(launch.promptDeliveryResult ? { promptDeliveryResult: launch.promptDeliveryResult } : {})
    }
  )
}

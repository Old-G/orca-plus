// Custom build (pulse-bell): what each button of a bell item does. Unknown kinds only close.
import { toast } from 'sonner'
import {
  PULSE_BELL_ACTION,
  PULSE_BELL_KIND,
  readContinueOnSubscriptionAction,
  readPulseBellPaneRef,
  readPulseBellSessionId,
  type PulseBellPaneRef
} from '../../../../../shared/pulse-bell'
import {
  HQ_BRIEFING_KIND,
  HQ_BRIEFING_OPEN_ACTION,
  HQ_BRIEFING_TAB,
  HQ_DEFERRED_KIND,
  HQ_DEFERRED_TAB
} from '../../../../../shared/hq-morning-briefing'
import type { PulseInboxItem } from '../../../../../shared/pulse-types'
import {
  HQ_SLACK_REQUEST_BELL_KIND,
  readHqSlackRequestRef
} from '../../../../../shared/hq-slack-request-bell'
import { parsePaneKey } from '../../../../../shared/stable-pane-id'
import { launchClaudeHandoffOffer } from '@/app-shell/use-claude-handoff-offers'
import { switchClaudeAccountTo } from '@/app-shell/use-claude-limit-guard'
import { activateTabAndFocusPane } from '@/lib/activate-tab-and-focus-pane'
import { activateStructuredAgentSessionTab } from '@/lib/agent-session/structured-agent-session-tab-activation'
import { activateAndRevealWorkspace } from '@/lib/worktree-activation'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import { openChatInShownHq } from '../hq/hq-chat-open'
import { openHqScreen } from '../hq/hq-view'
import { requestHqReport } from '../hq/hq-report-target'
import { HQ_REPORT_BELL_KIND, HQ_REPORT_OPEN_ACTION } from '../../../../../shared/hq-reports'
import { HQ_PROMISE_DUE_KIND, HQ_PROMISE_OPEN_ACTION } from '../../../../../shared/hq-promises'
import {
  HQ_SLACK_DIGEST_KIND,
  HQ_SLACK_DIGEST_OPEN_ACTION
} from '../../../../../shared/hq-slack-digest'
import { runHqSlackRequestAction } from '../slack-requests/hq-slack-request-actions'
import { HQ_REMIND_ACTION, HQ_REMIND_KIND } from '../../../../../shared/hq-remind'
import { startHqRemind } from '../hq/hq-remind-chat'

function paneRefTabId(ref: PulseBellPaneRef): string | undefined {
  return ref.tabId ?? parsePaneKey(ref.paneKey)?.tabId
}

function openPane(ref: PulseBellPaneRef): void {
  if (!ref.worktreeId) {
    return
  }
  const tabId = paneRefTabId(ref)
  if (openChatInShownHq(ref.worktreeId, tabId)) {
    return
  }
  if (activateAndRevealWorkspace(ref.worktreeId, { revealInSidebar: false }) === false) {
    return
  }
  if (
    ref.tabId &&
    activateStructuredAgentSessionTab({ worktreeId: ref.worktreeId, tabId: ref.tabId })
  ) {
    return
  }
  const state = useAppStore.getState()
  if (!tabId || !(state.tabsByWorktree[ref.worktreeId] ?? []).some((tab) => tab.id === tabId)) {
    return
  }
  state.setActiveTabType('terminal', ref.worktreeId)
  const parsed = parsePaneKey(ref.paneKey)
  activateTabAndFocusPane(tabId, parsed?.tabId === tabId ? parsed.leafId : null, {
    flashFocusedPane: true,
    scrollToBottomIfOutputSinceLastView: true
  })
}

/** Custom build (hq-reports): HQ's Reports page on this report. */
function openHqReport(path: string): void {
  requestHqReport(path)
  openHqScreen('reports')
}

/** Where a bell item leads, without answering it; a tap on its phone push opens the same place. */
export function openPulseBellItemTarget(item: PulseInboxItem): boolean {
  if (item.kind === PULSE_BELL_KIND.agentWaiting || item.kind === PULSE_BELL_KIND.agentFinished) {
    const ref = readPulseBellPaneRef(item.refId)
    if (ref) {
      openPane(ref)
      return true
    }
  }
  if (item.kind === HQ_BRIEFING_KIND) {
    openHqScreen(HQ_BRIEFING_TAB)
    return true
  }
  if (item.kind === HQ_DEFERRED_KIND) {
    openHqScreen(HQ_DEFERRED_TAB)
    return true
  }
  if (item.kind === HQ_SLACK_REQUEST_BELL_KIND || item.kind === HQ_SLACK_DIGEST_KIND) {
    openHqScreen('today')
    return true
  }
  // Custom build (hq-promises): a promise due soon leads to Notes, where it sits under «on me».
  if (item.kind === HQ_PROMISE_DUE_KIND || item.kind === HQ_REMIND_KIND) {
    openHqScreen('waiting')
    return true
  }
  if (item.kind === HQ_REPORT_BELL_KIND && item.refId) {
    openHqReport(item.refId)
    return true
  }
  return false
}

/** The user opened this chat in HQ, so its finish toast and bell item close as Open would. */
export async function closeFinishedPulseBellItemsForHqChat(
  worktreeId: string,
  tabId: string
): Promise<void> {
  const items = await window.api.pulseBell.list()
  const opened = items.filter((item) => {
    const ref =
      item.kind === PULSE_BELL_KIND.agentFinished ? readPulseBellPaneRef(item.refId) : null
    return !!ref && ref.worktreeId === worktreeId && paneRefTabId(ref) === tabId
  })
  await Promise.all(
    opened.map((item) => window.api.pulseBell.markDone(item.id, PULSE_BELL_ACTION.open))
  )
}

/** Runs the button, then closes the item unless its producer closes it on its own. */
export async function runPulseBellAction(item: PulseInboxItem, actionId: string): Promise<void> {
  const slackRequest =
    item.kind === HQ_SLACK_REQUEST_BELL_KIND ? readHqSlackRequestRef(item.refId) : null
  if (slackRequest) {
    await runHqSlackRequestAction(slackRequest.id, actionId)
    // Why: the item closes once HQ records the decision; Edit is not one, and a failure keeps it.
    await window.api.pulseBell.markRead([item.id])
    return
  }
  if (item.kind === PULSE_BELL_KIND.handoff && item.refId) {
    if (actionId === PULSE_BELL_ACTION.launch) {
      await launchClaudeHandoffOffer(item.refId)
      return
    }
    if (actionId === PULSE_BELL_ACTION.dismiss) {
      await window.api.claudeHandoff.dismiss(item.refId)
      return
    }
  }
  if (item.kind === PULSE_BELL_KIND.agentWaiting && actionId === PULSE_BELL_ACTION.open) {
    const ref = readPulseBellPaneRef(item.refId)
    if (ref) {
      openPane(ref)
    }
    // Why: the item closes itself when the agent stops waiting; opening is not answering.
    await window.api.pulseBell.markRead([item.id])
    return
  }
  if (item.kind === HQ_BRIEFING_KIND && actionId === HQ_BRIEFING_OPEN_ACTION) {
    openHqScreen(HQ_BRIEFING_TAB)
  }
  if (item.kind === HQ_DEFERRED_KIND && actionId === PULSE_BELL_ACTION.open) {
    openHqScreen(HQ_DEFERRED_TAB)
  }
  if (item.kind === HQ_PROMISE_DUE_KIND && actionId === HQ_PROMISE_OPEN_ACTION) {
    openHqScreen('waiting')
  }
  if (item.kind === HQ_REPORT_BELL_KIND && actionId === HQ_REPORT_OPEN_ACTION && item.refId) {
    openHqReport(item.refId)
  }
  // Custom build (hq-remind): a failed start keeps the line for another try.
  if (item.kind === HQ_REMIND_KIND && actionId === HQ_REMIND_ACTION && item.refId) {
    const started = await startHqRemind(item.refId)
    if (!started.ok) {
      toast.error(started.message)
      return
    }
  }
  // Custom build (hq-scout-digest): the digest leads to HQ → Today, where the requests wait.
  if (item.kind === HQ_SLACK_DIGEST_KIND && actionId === HQ_SLACK_DIGEST_OPEN_ACTION) {
    openHqScreen('today')
  }
  if (item.kind === PULSE_BELL_KIND.agentFinished && actionId === PULSE_BELL_ACTION.open) {
    const ref = readPulseBellPaneRef(item.refId)
    if (ref) {
      openPane(ref)
    }
  }
  const continueOn = readContinueOnSubscriptionAction(actionId)
  const chatSessionId = readPulseBellSessionId(item.refId)
  if (item.kind === PULSE_BELL_KIND.claudeChatLimit && continueOn && chatSessionId) {
    const moved = await window.api.claudeLimitGuard.continueOnSubscription({
      sessionId: chatSessionId,
      subscriptionId: continueOn
    })
    if (!moved.ok) {
      toast.error(
        translate('auto.pulseBell.chatLimit.moveFailed', 'The chat could not continue there'),
        { description: moved.reason }
      )
      // Why: the stop stays recorded, so the item stays for another try.
      return
    }
  }
  if (item.kind === PULSE_BELL_KIND.claudeAuthStop && actionId === PULSE_BELL_ACTION.continue) {
    const { resumed } = await window.api.claudeLimitGuard.continueAuthStops()
    toast.success(
      translate('auto.pulseBell.authStop.continued', 'Sent «продолжай» to {{count}} agent(s)', {
        count: resumed
      })
    )
  }
  if (
    item.kind === PULSE_BELL_KIND.claudeLimit &&
    actionId === PULSE_BELL_ACTION.switchAccount &&
    item.refId
  ) {
    await switchClaudeAccountTo(item.refId)
  }
  await window.api.pulseBell.markDone(item.id, actionId)
}

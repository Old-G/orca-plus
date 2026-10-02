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
import { parsePaneKey } from '../../../../../shared/stable-pane-id'
import { launchClaudeHandoffOffer } from '@/app-shell/use-claude-handoff-offers'
import { switchClaudeAccountTo } from '@/app-shell/use-claude-limit-guard'
import { activateTabAndFocusPane } from '@/lib/activate-tab-and-focus-pane'
import { activateStructuredAgentSessionTab } from '@/lib/structured-agent-session-tab-activation'
import { activateAndRevealWorkspace } from '@/lib/worktree-activation'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import { openHqScreen } from '../hq/hq-view'

function openPane(ref: PulseBellPaneRef): void {
  if (!ref.worktreeId) {
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
  const tabId = ref.tabId ?? parsePaneKey(ref.paneKey)?.tabId
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

/** Runs the button, then closes the item unless its producer closes it on its own. */
export async function runPulseBellAction(item: PulseInboxItem, actionId: string): Promise<void> {
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
  if (
    item.kind === PULSE_BELL_KIND.claudeLimit &&
    actionId === PULSE_BELL_ACTION.switchAccount &&
    item.refId
  ) {
    await switchClaudeAccountTo(item.refId)
  }
  await window.api.pulseBell.markDone(item.id, actionId)
}

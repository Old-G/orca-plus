// Custom build: Orca+ settings, kept apart so upstream edits to GlobalSettings do not collide.
import type { CustomAppearanceBackground } from './custom-appearance-background'
import type { CustomAppearanceTheme } from './vscode-theme/custom-appearance-theme'
import type { ClaudeSubscriptionSettings } from './claude-subscriptions'
import type { HqProjectClickUpLists } from './hq-project-clickup'
import type { TaskProviderRolloutFlags } from './work-items/task-providers'
import type { HqTriageDecisions } from './hq-triage'
import type { OrcaPlusQuietHours } from './orca-plus-quiet-hours'
import type { HqOpenLoopsMode } from './hq-open-loops-mode'

/** Custom build (claude-subscriptions): Claude sign-ins a session can run on. */
export type CustomBuildSettings = ClaudeSubscriptionSettings &
  TaskProviderRolloutFlags & {
    /** Load `custom.css` on top of the built-in theme and reload it on save. */
    customCssEnabled?: boolean
    /** Custom build (custom-appearance): master switch for custom.css, background and imported theme. */
    customAppearanceEnabled?: boolean
    /** Custom build (appearance-background): window background image, drawn only while the block is on. */
    customAppearanceBackground?: CustomAppearanceBackground | null
    /** Custom build (custom-appearance-theme): the imported VS Code theme in use, while the block is on. */
    customAppearanceTheme?: CustomAppearanceTheme | null
    /** Custom build (hq-roster-sync): HQ meta-wiki root; adding or removing a project syncs its registry. */
    hqPath?: string | null
    /** Custom build (hq-screen): the ClickUp list each project's HQ card shows tasks from, by repo id. */
    hqProjectClickUpLists?: HqProjectClickUpLists
    /** Custom build (hq-screen): minutes an unfinished session stays quiet before HQ lists it; default 30. */
    hqDeferredAfterMinutes?: number
    /** Custom build (hq-screen): closed deferred sessions — pane key → the quiet spell that was closed. */
    hqDeferredDismissed?: Record<string, number>
    /** Custom build (hq-chats): HQ opens on its Chats view; false keeps only the earlier tabs. Default on. */
    hqChatsView?: boolean
    /** Custom build (hq-chats): projects whose latest chats stay on view in HQ even when quiet. */
    hqKeptProjectIds?: string[]
    /** Custom build (hq-marked-chats): chats the owner marked to come back to, by HQ chat key. */
    hqMarkedChatKeys?: string[]
    /** Custom build (hq-pinned-counts): when each pinned item (reports, feed, journal) was last opened. */
    hqPinnedSeenAt?: Record<string, number>
    /** Custom build (hq-spaces): the workspace HQ shows (`workspaces/<slug>`); unset or null = all. */
    hqActiveSpace?: string | null
    /** Custom build (hq-triage): ClickUp tasks the owner took or hid in HQ «New tasks», by task id. */
    hqTriageDecisions?: HqTriageDecisions
    /** Custom build (chat-cleanup): quiet chats are left alone, only reported in HQ, or closed; default report. */
    hqChatCleanup?: 'off' | 'report' | 'on'
    /** Custom build (hq-ask): the standing «Ask HQ» chat questions go to, while it stays open. */
    hqAskSessionId?: string | null
    /** Custom build (hq-voice-prompts): a finished dictation opens a preview to pick what it becomes. */
    hqVoicePromptsEnabled?: boolean
    /** Custom build (hq-plus-ui): HQ events land in HQ+'s feed instead of popping up; default on. */
    hqPlusFeedInsteadOfPopups?: boolean
    /** Custom build (hq-plus-journal): HQ+'s journal follows Orca+'s records; off stops it. Default on. */
    hqPlusJournalEnabled?: boolean
    /** Custom build (hq-request-ledger): the request ledger — off, in shadow (reads the cards into
     *  conversations beside them, changes nothing shown) or on (one card per Slack conversation in
     *  place of the mention cards). Default on since 03.11 (hq-ledger-mode). */
    hqLedger?: 'off' | 'shadow' | 'on'
    /** Custom build (hq-open-loops): the open-loop detector is off or reports what it finds
     *  to the HQ+ journal; default report (hq-open-loops-mode). */
    hqOpenLoops?: HqOpenLoopsMode
    /** Custom build (slack-notifications, owner 03.11): agent updates posted to Slack by the bot;
     *  off unless turned on. */
    slackAgentUpdates?: boolean
    /** Custom build (hq-plus-sessions): the session dispatcher is off, only writes what it would do,
     *  or continues, opens and queues chats itself; default report. */
    hqSessionDispatcher?: 'off' | 'report' | 'on'
    /** Custom build (hq-handoff-auto): a chat's handoff starts the new chat by itself, whatever the
     *  dispatcher's mode; default on. */
    hqHandoffAutoStart?: boolean
    /** Custom build (worktree-sweep): a chat the owner closes takes its worktree with it once the work there
     *  is merged and nothing else is open in it; default on. */
    worktreeSweepOnChatClose?: boolean
    /** Custom build (hq-read-aloud): speed, voice and auto-reading of the chat's «Read aloud». */
    hqReadAloud?: { rate: number; voiceURI: string | null; auto: boolean }
    /** Custom build (hq-night-shift): hour the night shift starts tasks queued «Tonight»; default 23. */
    hqNightShiftHour?: number
    /** Custom build (network auto-continue, A10 28.11): an agent whose turn a network error cut
     *  continues by itself — up to 3 nudges in a row, 1, 3 and 10 minutes after the stop. Default on. */
    claudeNetworkAutoContinue?: boolean
    /** Custom build (chat-auto-effort): each message to a Claude chat picks medium, high or xhigh effort. */
    nativeChatAutoEffort?: boolean
    /** Custom build (hq-router, owner 26.11): the 👾 router — off, or the trial: every card waits on
     *  «Send» but a thread already sent to a chat. Default trial. */
    hqRouter?: 'off' | 'trial'
    /** Custom build (hq-router): the 👾 marks already there when the trial first ran; never routed.
     *  Why keys, not a time: Slack gives no time for a reaction, only the message's. */
    hqRouterPreTrial?: string[]
    /** Custom build (hq-router): an env file with `OPENROUTER_API_KEY`, when Orca+'s environment has none. */
    hqRouterKeyFile?: string | null
    /** Custom build (hq-router two marks, 28.11): the Slack emoji name (no colons) of the second mark —
     *  🆕 = new work, a new chat starts by itself. Unset = `new`; an empty string turns the mark off. */
    hqRouterNewMark?: string
    /** Custom build (hq-router two marks): the 🆕 marks already there when it first ran; never started. */
    hqRouterNewPreTrial?: string[]
    /** Custom build (hq-router crumbs): footers carry the sending chat and the router reads them. Default on. */
    hqRouterCrumbs?: boolean
    /** Custom build (hq-router auto classes, router v2 T4): a 👾 route class sends by itself once the router
     *  log of the last `days` holds at least `minN` decided cards of it and `minRight` (0..1) of them went
     *  to the offered chat. Unset fields = 30 cards, 0.98, 30 days. */
    hqRouterAuto?: { minN?: number; minRight?: number; days?: number } | null
    /** Custom build (hq-router send first, router v2 T5): a 👾 to a chat that is not auto yet goes there at
     *  once with a «check first» instruction; «не моё» passes it on, «Wrong chat» on the card undoes it.
     *  Default on; false = the card waits for «Send» as before. */
    hqRouterSendFirst?: boolean
    /** Custom build (quiet-hours): no phone or Slack alerts but urgent ones; unset or null = off. */
    orcaPlusQuietHours?: OrcaPlusQuietHours | null
    /** Custom build (hq-palette): HQ+'s colours — `classic` (the old ice-blue / Paper) or `graphite`
     *  («Графит» dark, «Бумага» light). Unset = classic. */
    hqPlusPalette?: 'classic' | 'graphite'
  }

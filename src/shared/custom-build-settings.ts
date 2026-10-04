// Custom build: Orca+ settings, kept apart so upstream edits to GlobalSettings do not collide.
import type { CustomAppearanceBackground } from './custom-appearance-background'
import type { CustomAppearanceTheme } from './vscode-theme/custom-appearance-theme'
import type { ClaudeSubscriptionSettings } from './claude-subscriptions'
import type { HqProjectClickUpLists } from './hq-project-clickup'
import type { TaskProviderRolloutFlags } from './task-providers'
import type { HqTriageDecisions } from './hq-triage'

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
    /** Custom build (hq-triage): ClickUp tasks the owner took or hid in HQ «New tasks», by task id. */
    hqTriageDecisions?: HqTriageDecisions
  }

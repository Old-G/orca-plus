// Custom build: Orca+ settings, kept apart so upstream edits to GlobalSettings do not collide.
import type { CustomAppearanceBackground } from './custom-appearance-background'
import type { CustomAppearanceTheme } from './vscode-theme/custom-appearance-theme'

export type CustomBuildSettings = {
  /** Custom build (custom-appearance): master switch for custom.css, background and imported theme. */
  customAppearanceEnabled?: boolean
  /** Custom build (appearance-background): window background image, drawn only while the block is on. */
  customAppearanceBackground?: CustomAppearanceBackground | null
  /** Custom build (custom-appearance-theme): the imported VS Code theme in use, while the block is on. */
  customAppearanceTheme?: CustomAppearanceTheme | null
  /** Custom build (hq-roster-sync): HQ meta-wiki root; adding or removing a project syncs its registry. */
  hqPath?: string | null
}

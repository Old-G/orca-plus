import { validThemeColor } from './vscode-theme-colors'
import type { ResolvedVscodeTheme } from './vscode-theme-types'

// Custom build (vscode-theme-import): Orca's main.css tokens ← VS Code workbench colors, most
// specific key first. A token no key covers keeps its stock value.
const TOKEN_SOURCES: readonly (readonly [string, readonly string[]])[] = [
  ['--background', ['sideBar.background', 'editor.background']],
  ['--foreground', ['foreground', 'editor.foreground', 'sideBar.foreground']],
  ['--editor-surface', ['editor.background']],
  ['--card', ['editorWidget.background', 'sideBar.background', 'editor.background']],
  ['--card-foreground', ['editorWidget.foreground', 'foreground', 'editor.foreground']],
  ['--popover', ['dropdown.background', 'menu.background', 'editorWidget.background']],
  ['--popover-foreground', ['dropdown.foreground', 'menu.foreground', 'foreground']],
  ['--primary', ['button.background', 'focusBorder']],
  ['--primary-foreground', ['button.foreground']],
  ['--secondary', ['button.secondaryBackground', 'input.background']],
  ['--secondary-foreground', ['button.secondaryForeground', 'foreground']],
  ['--muted', ['input.background', 'editorWidget.background']],
  ['--muted-foreground', ['descriptionForeground', 'disabledForeground', 'tab.inactiveForeground']],
  ['--accent', ['list.hoverBackground', 'list.inactiveSelectionBackground']],
  ['--accent-foreground', ['list.hoverForeground', 'foreground']],
  ['--destructive', ['errorForeground', 'editorError.foreground']],
  ['--border', ['panel.border', 'sideBar.border', 'editorGroup.border', 'contrastBorder']],
  ['--input', ['input.border', 'input.background']],
  ['--ring', ['focusBorder']],
  ['--sidebar', ['sideBar.background']],
  ['--sidebar-foreground', ['sideBar.foreground', 'foreground']],
  ['--sidebar-primary', ['activityBarBadge.background', 'button.background']],
  ['--sidebar-primary-foreground', ['activityBarBadge.foreground', 'button.foreground']],
  ['--sidebar-accent', ['list.activeSelectionBackground', 'list.hoverBackground']],
  ['--sidebar-accent-foreground', ['list.activeSelectionForeground', 'foreground']],
  ['--sidebar-border', ['sideBar.border', 'panel.border']],
  ['--sidebar-ring', ['focusBorder']],
  ['--worktree-sidebar', ['sideBar.background']],
  ['--worktree-sidebar-foreground', ['sideBar.foreground', 'foreground']],
  ['--worktree-sidebar-accent', ['list.activeSelectionBackground', 'list.hoverBackground']],
  ['--worktree-sidebar-accent-foreground', ['list.activeSelectionForeground', 'foreground']],
  ['--worktree-sidebar-border', ['sideBar.border', 'panel.border']],
  ['--worktree-sidebar-ring', ['focusBorder']],
  // Why one var for both: Orca's titlebar and status bar both read --bg-titlebar.
  ['--bg-titlebar', ['titleBar.activeBackground', 'statusBar.background']],
  ['--git-decoration-added', ['gitDecoration.addedResourceForeground']],
  ['--git-decoration-modified', ['gitDecoration.modifiedResourceForeground']],
  ['--git-decoration-deleted', ['gitDecoration.deletedResourceForeground']],
  ['--git-decoration-renamed', ['gitDecoration.renamedResourceForeground']],
  ['--git-decoration-untracked', ['gitDecoration.untrackedResourceForeground']],
  ['--git-decoration-ignored', ['gitDecoration.ignoredResourceForeground']],
  [
    '--diff-added-ground',
    ['diffEditor.insertedTextBackground', 'diffEditor.insertedLineBackground']
  ],
  [
    '--diff-removed-ground',
    ['diffEditor.removedTextBackground', 'diffEditor.removedLineBackground']
  ],
  ['--diff-added-gutter', ['editorGutter.addedBackground']],
  ['--diff-removed-gutter', ['editorGutter.deletedBackground']]
]

export function toAppTokens(theme: ResolvedVscodeTheme): Record<string, string> {
  const tokens: Record<string, string> = {}
  for (const [token, keys] of TOKEN_SOURCES) {
    for (const key of keys) {
      const color = validThemeColor(theme.colors[key])
      if (color) {
        tokens[token] = color
        break
      }
    }
  }
  return tokens
}

/**
 * Same specificity as main.css, so it wins only by cascade order (adopted sheets come after
 * document sheets) and a user's custom.css, adopted after it, still wins over the theme.
 * `.plugin-security-chrome` re-declares its tokens deeper in the tree, so consent dialogs
 * keep their stock contrast.
 */
export function buildAppTokensCss(tokens: Record<string, string>): string {
  const body = Object.entries(tokens)
    .map(([token, color]) => `  ${token}: ${color};`)
    .join('\n')
  return `:root, .dark, .light {\n${body}\n}`
}

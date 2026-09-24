import type { TerminalColorOverrides } from '../terminal-color-overrides'
import { flattenThemeColor, parseThemeColor } from './vscode-theme-colors'
import { isDarkVscodeThemeBase, type ResolvedVscodeTheme } from './vscode-theme-types'

// Custom build (vscode-theme-import): xterm colors from a VS Code theme. xterm rejects alpha, so
// translucent values are composited over the terminal background first.

const ANSI_KEYS: readonly (readonly [keyof TerminalColorOverrides, string])[] = [
  ['black', 'terminal.ansiBlack'],
  ['red', 'terminal.ansiRed'],
  ['green', 'terminal.ansiGreen'],
  ['yellow', 'terminal.ansiYellow'],
  ['blue', 'terminal.ansiBlue'],
  ['magenta', 'terminal.ansiMagenta'],
  ['cyan', 'terminal.ansiCyan'],
  ['white', 'terminal.ansiWhite'],
  ['brightBlack', 'terminal.ansiBrightBlack'],
  ['brightRed', 'terminal.ansiBrightRed'],
  ['brightGreen', 'terminal.ansiBrightGreen'],
  ['brightYellow', 'terminal.ansiBrightYellow'],
  ['brightBlue', 'terminal.ansiBrightBlue'],
  ['brightMagenta', 'terminal.ansiBrightMagenta'],
  ['brightCyan', 'terminal.ansiBrightCyan'],
  ['brightWhite', 'terminal.ansiBrightWhite']
]

/** Only the colors the theme defines; the user's terminal theme fills in the rest. */
export function toTerminalOverrides(theme: ResolvedVscodeTheme): TerminalColorOverrides {
  const { colors } = theme
  const dark = isDarkVscodeThemeBase(theme.base)
  const background =
    parseThemeColor(colors['terminal.background']) ??
    parseThemeColor(colors['panel.background']) ??
    parseThemeColor(colors['editor.background'])
  const backdrop = background ?? { r: dark ? 0 : 255, g: dark ? 0 : 255, b: dark ? 0 : 255, a: 1 }
  const pick = (...keys: string[]): string | undefined => {
    for (const key of keys) {
      const color = flattenThemeColor(colors[key], backdrop)
      if (color) {
        return color
      }
    }
    return undefined
  }
  const overrides: TerminalColorOverrides = {
    background: background
      ? pick('terminal.background', 'panel.background', 'editor.background')
      : undefined,
    foreground: pick('terminal.foreground', 'editor.foreground', 'foreground'),
    cursor: pick('terminalCursor.foreground', 'editorCursor.foreground'),
    cursorAccent: pick('terminalCursor.background'),
    selectionBackground: pick('terminal.selectionBackground', 'editor.selectionBackground'),
    selectionForeground: pick('terminal.selectionForeground')
  }
  for (const [key, source] of ANSI_KEYS) {
    overrides[key] = pick(source)
  }
  return Object.fromEntries(
    Object.entries(overrides).filter((entry): entry is [string, string] => entry[1] !== undefined)
  )
}

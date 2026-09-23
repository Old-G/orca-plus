import type { ClaudeIdeToolContent } from './claude-ide-tool-catalog'

// Result texts of the extension's openDiff/close_tab/closeAllDiffTabs; the CLI
// matches them literally (FILE_SAVED + contents, DIFF_REJECTED + tab name).

const text = (value: string): ClaudeIdeToolContent => ({ type: 'text', text: value })

export function formatOpenDiffResult(
  reply: string,
  args: Record<string, unknown>
): ClaudeIdeToolContent[] {
  const outcome: { accepted?: unknown; contents?: unknown } = JSON.parse(reply)
  if (outcome.accepted === true && typeof outcome.contents === 'string') {
    return [text('FILE_SAVED'), text(outcome.contents)]
  }
  return [text('DIFF_REJECTED'), text(String(args.tab_name ?? ''))]
}

export function formatCloseTabResult(): ClaudeIdeToolContent[] {
  return [text('TAB_CLOSED')]
}

export function formatCloseAllDiffTabsResult(reply: string): ClaudeIdeToolContent[] {
  const { closed }: { closed?: unknown } = JSON.parse(reply)
  return [text(`CLOSED_${typeof closed === 'number' ? closed : 0}_DIFF_TABS`)]
}

// Custom build (hq-fix-now-all): the line «Fix now» leaves under a Codex report — which chats it
// opened, which projects wait, and which findings a chat already had, so it never just says «nothing».
import type { HqRouteHandled, HqRouteResult } from './hq-routing'

/** The bell's done action of a report «Fix now» took; the rest of it is the result line. */
export const HQ_FIX_NOW_DONE_PREFIX = 'fix-now:'

const LEVEL = /^\[(P\d)\]/

function handledLabel(item: HqRouteHandled): string {
  const level = LEVEL.exec(item.title)?.[1]
  const by = item.commit ? item.commit.slice(0, 10) : item.address
  return `${item.project}${level ? ` ${level}` : ''}${by ? ` (${by})` : ''}`
}

function chats(count: number): string {
  return count === 1 ? '1 fixing chat' : `${count} fixing chats`
}

export function hqFixNowSummary(result: Pick<HqRouteResult, 'actions' | 'handled'>): {
  ok: boolean
  text: string
} {
  const handled = result.handled ?? []
  const opened = result.actions.filter((action) => action.kind === 'open' && action.sessionId)
  const failed = result.actions.filter((action) => action.kind === 'open' && !action.sessionId)
  const continued = result.actions.filter((action) => action.kind === 'continue')
  const suggested = result.actions.filter((action) => action.kind === 'suggest')
  const waiting = result.actions.filter((action) => action.kind === 'wait')
  const names = (list: typeof result.actions): string =>
    list.map((action) => action.project).join(', ')
  const notes = (list: typeof result.actions): string =>
    list.map((action) => `${action.project}${action.note ? ` (${action.note})` : ''}`).join(', ')
  if (result.actions.length === 0) {
    return handled.length > 0
      ? { ok: true, text: `All findings already handled — ${handled.map(handledLabel).join(', ')}` }
      : { ok: false, text: 'This report has no findings in the journal.' }
  }
  const parts = [
    opened.length > 0 ? `Opened ${chats(opened.length)}: ${names(opened)}` : null,
    continued.length > 0 ? `handed to today’s chat: ${names(continued)}` : null,
    suggested.length > 0 ? `asks you first (autonomy 0): ${names(suggested)}` : null,
    waiting.length > 0 ? `waits: ${notes(waiting)}` : null,
    failed.length > 0 ? `did not start: ${notes(failed)}` : null,
    handled.length > 0 ? `already handled: ${handled.map(handledLabel).join(', ')}` : null
  ].filter((part): part is string => part !== null)
  const text = parts.join(' · ')
  return {
    ok: opened.length + continued.length + suggested.length > 0,
    text: text.charAt(0).toUpperCase() + text.slice(1)
  }
}

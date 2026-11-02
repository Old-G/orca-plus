// Custom build (hq-plus-terminal-drafts, owner 02.11: «a chat open as a terminal does not land in drafts»):
// what the owner typed into a terminal agent's own input box (Claude Code, Codex) and has not sent yet.
// The terminal only sees keystrokes, so a moment after typing stops the box is read off the screen.
import type { Terminal } from '@xterm/xterm'

export type HqPlusTerminalDraft = { paneKey: string; text: string; savedAt: number }

const READ_AFTER_MS = 700
const BOTTOM_ROWS = 30
const PROMPT = /^(?:[│|]\s*)?([>❯›])\s(.*)$/
const RULE = /^[\s│|]*[─━═╌┄]{6,}/
const BOX_EDGE = /^\s*[╭╰]/

const drafts = new Map<string, HqPlusTerminalDraft>()
const listeners = new Set<() => void>()
const timers = new Map<string, ReturnType<typeof setTimeout>>()

function emit(): void {
  for (const listener of listeners) {
    listener()
  }
}

function strip(row: string): string {
  return row.replace(/^\s*[│|]/, '').replace(/[│|]\s*$/, '')
}

/**
 * The unsent text in the agent's input box at the bottom of the screen; '' when the box is empty or
 * shows its dim placeholder, null when no input box is on screen. The box is the lowest prompt row
 * (`>`, `❯`, `›`), its continuation rows indented under it, up to a rule or the box's bottom edge.
 */
export function hqPlusReadTerminalInputBox(
  rows: readonly string[],
  isDim: (row: number, col: number) => boolean
): string | null {
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const row = rows[index] ?? ''
    const match = PROMPT.exec(row.trimStart())
    if (!match) {
      continue
    }
    const first = (match[2] ?? '').replace(/[│|]\s*$/, '').trimEnd()
    const after = row.slice(row.indexOf(match[1] ?? '') + 1)
    const col = row.length - after.length + (after.length - after.trimStart().length)
    if (!first.trim() || isDim(index, col)) {
      return ''
    }
    const lines = [first.trim()]
    for (const next of rows.slice(index + 1)) {
      if (RULE.test(next) || BOX_EDGE.test(next) || !/^\s{2,}\S/.test(strip(next))) {
        break
      }
      lines.push(strip(next).trim())
    }
    return lines.join('\n').trim()
  }
  return null
}

function readScreen(paneKey: string, terminal: Terminal): void {
  const buffer = terminal.buffer.active
  // The live screen's bottom, not where the owner scrolled to: a past prompt up there is no draft.
  const end = buffer.baseY + terminal.rows
  const start = Math.max(buffer.baseY, end - BOTTOM_ROWS)
  const rows: string[] = []
  for (let y = start; y < end; y += 1) {
    rows.push(buffer.getLine(y)?.translateToString(true) ?? '')
  }
  const text = hqPlusReadTerminalInputBox(
    rows,
    (row, col) =>
      buffer
        .getLine(start + row)
        ?.getCell(col)
        ?.isDim() === 1
  )
  if (text === null) {
    return
  }
  const known = drafts.get(paneKey)
  if (!text) {
    if (known && drafts.delete(paneKey)) {
      emit()
    }
    return
  }
  if (known?.text !== text) {
    drafts.set(paneKey, { paneKey, text, savedAt: Date.now() })
    emit()
  }
}

/** Called on the owner's own keystrokes in a terminal pane; reads its agent's input box once typing pauses. */
export function noteHqPlusTerminalTyping(paneKey: string, terminal: Terminal): void {
  clearTimeout(timers.get(paneKey))
  timers.set(
    paneKey,
    setTimeout(() => {
      timers.delete(paneKey)
      try {
        readScreen(paneKey, terminal)
      } catch {
        // A disposed terminal has no screen; its draft goes with its chat.
      }
    }, READ_AFTER_MS)
  )
}

export function listHqPlusTerminalDrafts(): HqPlusTerminalDraft[] {
  return [...drafts.values()]
}

export function subscribeToHqPlusTerminalDrafts(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

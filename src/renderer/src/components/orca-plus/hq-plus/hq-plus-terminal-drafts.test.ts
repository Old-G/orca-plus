import type { Terminal } from '@xterm/xterm'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  hqPlusReadTerminalInputBox,
  listHqPlusTerminalDrafts,
  noteHqPlusTerminalTyping
} from './hq-plus-terminal-drafts'

const plain = (): boolean => false

// Custom build (hq-plus-terminal-drafts, owner 02.11).
describe('the unsent words in a terminal agent input box', () => {
  it('reads Claude Code’s box between rules, continuation rows included', () => {
    const rows = [
      '> an earlier prompt in the transcript',
      '⏺ Done.',
      '────────────────────────────',
      '> check the second card',
      '  and the left column',
      '────────────────────────────',
      '  ? for shortcuts'
    ]
    expect(hqPlusReadTerminalInputBox(rows, plain)).toBe(
      'check the second card\nand the left column'
    )
  })

  it('reads the boxed and the Codex prompt', () => {
    expect(
      hqPlusReadTerminalInputBox(['╭──────────╮', '│ > hello Ann   │', '╰──────────╯'], plain)
    ).toBe('hello Ann')
    expect(
      hqPlusReadTerminalInputBox(['• Ran tests', '', '› fix the bug', '', '  ⏎ send'], plain)
    ).toBe('fix the bug')
  })

  it('treats an empty box or its dim placeholder as no draft, and no box as unknown', () => {
    expect(hqPlusReadTerminalInputBox(['──────────', '> ', '──────────'], plain)).toBe('')
    expect(
      hqPlusReadTerminalInputBox(
        ['› Ask Codex to do anything'],
        (row, col) => row === 0 && col === 2
      )
    ).toBe('')
    expect(hqPlusReadTerminalInputBox(['$ ls', 'README.md'], plain)).toBeNull()
  })
})

function screen(rows: string[]): { terminal: Terminal; show: (next: string[]) => void } {
  let current = rows
  const terminal = {
    get rows() {
      return current.length
    },
    buffer: {
      active: {
        baseY: 0,
        getLine: (y: number) => ({
          translateToString: () => current[y] ?? '',
          getCell: () => ({ isDim: () => 0 })
        })
      }
    }
  } as unknown as Terminal
  return { terminal, show: (next) => (current = next) }
}

// Codex 02.11 (stale-draft-after-send): what was sent leaves the drafts even when the agent hides its box.
describe('a terminal draft after the owner sends it', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('goes on Enter, and an echoed prompt above is not read as a new draft', () => {
    vi.useFakeTimers()
    const pane = screen(['────────', '> fix the bug', '────────'])
    noteHqPlusTerminalTyping('tab-1:leaf-1', pane.terminal, 'g')
    vi.advanceTimersByTime(1_000)
    expect(listHqPlusTerminalDrafts().map((draft) => draft.text)).toEqual(['fix the bug'])

    pane.show(['> fix the bug', '⏺ Working…', ''])
    noteHqPlusTerminalTyping('tab-1:leaf-1', pane.terminal, '\r')
    vi.advanceTimersByTime(1_000)
    expect(listHqPlusTerminalDrafts()).toEqual([])
  })

  it('goes when the input box is no longer on screen', () => {
    vi.useFakeTimers()
    const pane = screen(['› ship it'])
    noteHqPlusTerminalTyping('tab-2:leaf-1', pane.terminal, 't')
    vi.advanceTimersByTime(1_000)
    expect(listHqPlusTerminalDrafts().map((draft) => draft.text)).toEqual(['ship it'])

    pane.show(['• Working (3s)', ''])
    noteHqPlusTerminalTyping('tab-2:leaf-1', pane.terminal, 'x')
    vi.advanceTimersByTime(1_000)
    expect(listHqPlusTerminalDrafts()).toEqual([])
  })
})


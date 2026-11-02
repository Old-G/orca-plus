import { describe, expect, it } from 'vitest'

import { hqPlusReadTerminalInputBox } from './hq-plus-terminal-drafts'

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

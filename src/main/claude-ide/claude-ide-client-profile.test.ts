import { describe, expect, it } from 'vitest'
import {
  isClaudeIdeClientFromOtherOrca,
  parseClaudeIdeClientEnv,
  splitPsEnvironmentLine
} from './claude-ide-client-terminal'

const psLine =
  '/Users/me/.local/bin/claude --ide TERM_PROGRAM=Orca ' +
  'ORCA_USER_DATA_PATH=/Users/me/Library/Application Support/orca ORCA_TAB_ID=tab-1 HOME=/Users/me'

describe('splitPsEnvironmentLine', () => {
  it('keeps spaces inside values, so profile paths survive', () => {
    expect(splitPsEnvironmentLine(psLine)).toContain(
      'ORCA_USER_DATA_PATH=/Users/me/Library/Application Support/orca'
    )
    expect(parseClaudeIdeClientEnv(splitPsEnvironmentLine(psLine))).toEqual({ tabId: 'tab-1' })
  })
})

describe('isClaudeIdeClientFromOtherOrca', () => {
  const own = '/Users/me/Library/Application Support/orca-plus'

  it('refuses a CLI running in another Orca build terminal', () => {
    expect(isClaudeIdeClientFromOtherOrca(splitPsEnvironmentLine(psLine), own)).toBe(true)
  })

  it('accepts its own terminals and terminals outside any Orca', () => {
    expect(isClaudeIdeClientFromOtherOrca([`ORCA_USER_DATA_PATH=${own}/`], own)).toBe(false)
    expect(isClaudeIdeClientFromOtherOrca(['claude', 'HOME=/Users/me'], own)).toBe(false)
  })
})

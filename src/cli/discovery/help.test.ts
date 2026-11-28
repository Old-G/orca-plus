import { describe, expect, it } from 'vitest'

import { findCommandSpec, isCommandGroup } from '../arguments/args'
import { COMMAND_SPECS } from '../specs'
import { formatCommandHelp, formatGroupHelp, formatHelp } from './help'

describe('formatGroupHelp', () => {
  it('reaches every command, hidden ones included, from its group typed by name', () => {
    for (const spec of COMMAND_SPECS) {
      for (let depth = 1; depth < spec.path.length; depth++) {
        const group = spec.path.slice(0, depth)
        if (findCommandSpec(COMMAND_SPECS, group)) {
          continue
        }
        expect(isCommandGroup(COMMAND_SPECS, group), group.join(' ')).toBe(true)
      }
    }
    expect(formatGroupHelp(COMMAND_SPECS, ['bot', 'look-around'])).toContain('  set ')
    expect(formatGroupHelp(COMMAND_SPECS, ['bot'])).not.toContain('  look-around set ')
  })
})

// Custom build (pulse-next, C1)
describe('help of the custom commands', () => {
  const spec = (...path: string[]) => {
    const found = findCommandSpec(COMMAND_SPECS, path)
    expect(found, path.join(' ')).toBeDefined()
    return found!
  }

  it('describes the pulse flags as pulse, not as the terminal flags of the same name', () => {
    const help = formatCommandHelp(spec('pulse', 'wait', 'add'))
    expect(help).toContain('--next <text>')
    expect(help).toContain('on-them: you wait on someone')
    expect(help).not.toMatch(/tab title|up\|down|worktree removal/i)
    expect(formatCommandHelp(spec('pulse', 'wait', 'update'))).toContain('--next <text|none>')
  })

  it('does not tell an agent to report by hand every turn', () => {
    const help = formatCommandHelp(spec('hq', 'report'))
    expect(help).not.toContain('once at the end of every turn')
    expect(help).toContain('Stop hook')
  })

  it('lists hq, pulse and chat send in orca --help', () => {
    const root = formatHelp(COMMAND_SPECS, [])
    expect(root).toMatch(/pulse wait add\|update/)
    expect(root).toMatch(/hq report /)
    expect(root).toMatch(/chat send /)
  })
})

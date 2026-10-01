import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  installOutgoingGateHook,
  OUTGOING_GATE_MATCHER,
  OUTGOING_GATE_TIMEOUT_SECONDS,
  removeOutgoingGateHook,
  withOutgoingGateHook
} from './outgoing-gate-hook-install'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

const userHooks = {
  model: 'opus',
  hooks: {
    PreToolUse: [
      { matcher: 'Bash', hooks: [{ type: 'command' as const, command: 'rtk hook claude' }] },
      {
        matcher: '*',
        hooks: [
          {
            type: 'command' as const,
            command: '/bin/sh "$HOME/.orca/agent-hooks/claude-hook.sh"',
            timeout: 10
          }
        ]
      }
    ],
    Stop: [{ hooks: [{ type: 'command' as const, command: 'strata-context-gate' }] }]
  }
}

describe('withOutgoingGateHook', () => {
  it('adds one gate entry and leaves every other hook alone', () => {
    const next = withOutgoingGateHook(userHooks, '/h/.orca/agent-hooks/outgoing-gate.sh')
    expect(next.model).toBe('opus')
    expect(next.hooks?.Stop).toEqual(userHooks.hooks.Stop)
    expect(next.hooks?.PreToolUse).toEqual([
      ...userHooks.hooks.PreToolUse,
      {
        matcher: OUTGOING_GATE_MATCHER,
        hooks: [
          {
            type: 'command',
            command: '/bin/sh "/h/.orca/agent-hooks/outgoing-gate.sh"',
            timeout: OUTGOING_GATE_TIMEOUT_SECONDS
          }
        ]
      }
    ])
  })

  it('replaces older gate entries instead of stacking them', () => {
    const once = withOutgoingGateHook(userHooks, '/old/.orca/agent-hooks/outgoing-gate.sh')
    const twice = withOutgoingGateHook(once, '/h/.orca/agent-hooks/outgoing-gate.sh')
    const gates = (twice.hooks?.PreToolUse ?? []).filter((d) => d.matcher === OUTGOING_GATE_MATCHER)
    expect(gates).toHaveLength(1)
    expect(gates[0].hooks?.[0].command).toContain('/h/.orca')
  })
})

describe.skipIf(process.platform === 'win32')('installOutgoingGateHook', () => {
  function tempSettings(content: string): { config: string; script: string } {
    const dir = mkdtempSync(join(tmpdir(), 'orca-gate-install-'))
    dirs.push(dir)
    const config = join(dir, 'settings.json')
    writeFileSync(config, content)
    return { config, script: join(dir, 'agent-hooks', 'outgoing-gate.sh') }
  }

  it('writes the script and the entry, and removes the entry again', () => {
    const { config, script } = tempSettings(JSON.stringify(userHooks))
    expect(installOutgoingGateHook(config, script)).toBe(true)
    expect(readFileSync(script, 'utf8')).toContain('/outgoing-gate/$1')
    const installed = JSON.parse(readFileSync(config, 'utf8'))
    expect(installed.hooks.PreToolUse).toHaveLength(3)
    removeOutgoingGateHook(config)
    expect(JSON.parse(readFileSync(config, 'utf8')).hooks).toEqual(userHooks.hooks)
  })

  it('does not overwrite an unreadable settings file', () => {
    const { config, script } = tempSettings('{ not json')
    expect(installOutgoingGateHook(config, script)).toBe(false)
    expect(readFileSync(config, 'utf8')).toBe('{ not json')
  })
})

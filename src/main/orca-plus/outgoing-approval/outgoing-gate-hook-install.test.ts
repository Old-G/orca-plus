import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  installOutgoingGateHook,
  OUTGOING_GATE_MATCHER,
  OUTGOING_GATE_TIMEOUT_SECONDS,
  removeOutgoingGateHook,
  withOutgoingGateHook,
  withOutgoingSentHook
} from './outgoing-gate-hook-install'
import { OUTGOING_SENT_MATCHER } from './outgoing-sent-hook-script'

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

describe('withOutgoingSentHook', () => {
  it('keeps one recorder entry in PostToolUse beside the user’s own', () => {
    const own = {
      hooks: {
        PostToolUse: [{ matcher: 'Edit', hooks: [{ type: 'command' as const, command: 'fmt' }] }]
      }
    }
    const once = withOutgoingSentHook(own, '/old/.orca/agent-hooks/outgoing-sent.sh')
    const twice = withOutgoingSentHook(once, '/h/.orca/agent-hooks/outgoing-sent.sh')
    expect(twice.hooks?.PostToolUse).toHaveLength(2)
    expect(twice.hooks?.PostToolUse?.[0]).toEqual(own.hooks.PostToolUse[0])
    expect(twice.hooks?.PostToolUse?.[1].hooks?.[0].command).toContain('/h/.orca')
  })
})

describe.skipIf(process.platform === 'win32')('installOutgoingGateHook', () => {
  function tempSettings(content: string): { config: string; script: string; sent: string } {
    const dir = mkdtempSync(join(tmpdir(), 'orca-gate-install-'))
    dirs.push(dir)
    const config = join(dir, 'settings.json')
    writeFileSync(config, content)
    return {
      config,
      script: join(dir, 'agent-hooks', 'outgoing-gate.sh'),
      sent: join(dir, 'agent-hooks', 'outgoing-sent.sh')
    }
  }

  it('writes the scripts and the entries, and removes the entries again', () => {
    const { config, script, sent } = tempSettings(JSON.stringify(userHooks))
    expect(installOutgoingGateHook(config, script, sent)).toBe(true)
    expect(readFileSync(script, 'utf8')).toContain('/outgoing-gate/$1')
    expect(readFileSync(sent, 'utf8')).toContain('/outgoing-gate/sent')
    const installed = JSON.parse(readFileSync(config, 'utf8'))
    expect(installed.hooks.PreToolUse).toHaveLength(3)
    expect(installed.hooks.PostToolUse).toEqual([
      {
        matcher: OUTGOING_SENT_MATCHER,
        hooks: [{ type: 'command', command: `/bin/sh "${sent}"`, timeout: 10 }]
      }
    ])
    removeOutgoingGateHook(config)
    expect(JSON.parse(readFileSync(config, 'utf8')).hooks).toEqual(userHooks.hooks)
  })

  it('does not overwrite an unreadable settings file', () => {
    const { config, script, sent } = tempSettings('{ not json')
    expect(installOutgoingGateHook(config, script, sent)).toBe(false)
    expect(readFileSync(config, 'utf8')).toBe('{ not json')
  })
})

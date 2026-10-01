import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { runProcess } from '../../../shared/child-process/run-process'
import { HELD_SHELL_COMMANDS } from '../../../shared/outgoing-approval/__fixtures__/outgoing-shell-commands'
import { AgentHookServer } from '../../agent-hooks/server'
import { PulseDb } from '../pulse/pulse-db'
import { OutgoingApprovalGate } from './outgoing-approval-gate'
import { createOutgoingGateRequestHandler } from './outgoing-gate-http'
import { buildOutgoingGateScript, OUTGOING_GATE_BASH_PREFILTER } from './outgoing-gate-hook-script'

const posix = process.platform !== 'win32'
const cleanups: (() => void)[] = []

afterEach(() => {
  for (const cleanup of cleanups.splice(0).toReversed()) {
    cleanup()
  }
})

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'orca-gate-test-'))
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

function writeScript(): string {
  const path = join(tempDir(), 'outgoing-gate.sh')
  writeFileSync(path, buildOutgoingGateScript())
  return path
}

function bashHook(command: string, toolUseId = 'toolu_1') {
  return JSON.stringify({
    session_id: 's1',
    cwd: '/repo',
    hook_event_name: 'PreToolUse',
    tool_name: 'Bash',
    tool_input: { command },
    tool_use_id: toolUseId
  })
}

async function startGate(userDataPath?: string, gate?: OutgoingApprovalGate) {
  const db = gate ? null : new PulseDb(':memory:')
  const held = gate ?? new OutgoingApprovalGate({ db: () => db!, holdMs: 300 })
  const server = new AgentHookServer()
  server.setOutgoingGateHandler(createOutgoingGateRequestHandler(() => held))
  await server.start({ env: 'production', ...(userDataPath ? { userDataPath } : {}) })
  let stopped = false
  const stop = (): void => {
    if (!stopped) {
      stopped = true
      server.stop()
    }
  }
  cleanups.push(() => {
    stop()
    db?.close()
  })
  return { gate: held, env: server.buildPtyEnv(), stop }
}

function cleanEnv(extra: Record<string, string>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    TMPDIR: tmpdir()
  }
  return { ...env, ...extra }
}

function runHook(script: string, input: string, env: Record<string, string>, timeoutMs = 20_000) {
  return runProcess({ program: '/bin/sh', args: [script], input, env: cleanEnv(env), timeoutMs })
}

async function waitForPending(gate: OutgoingApprovalGate): Promise<string> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const [draft] = gate.pending()
    if (draft) {
      return draft.id
    }
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error('no held call appeared')
}

function hookOutput(stdout: string) {
  return JSON.parse(stdout.trim()).hookSpecificOutput
}

describe('outgoing gate prefilter', () => {
  it.each(HELD_SHELL_COMMANDS)('lets the server see %s', (command) => {
    expect(new RegExp(OUTGOING_GATE_BASH_PREFILTER).test(bashHook(command))).toBe(true)
  })

  it('stays quiet for an everyday command', () => {
    expect(new RegExp(OUTGOING_GATE_BASH_PREFILTER).test(bashHook('ls -la src'))).toBe(false)
    expect(new RegExp(OUTGOING_GATE_BASH_PREFILTER).test(bashHook('pnpm test'))).toBe(false)
  })
})

describe.skipIf(!posix)('outgoing gate hook script', () => {
  it('passes everything outside an Orca session', async () => {
    const result = await runHook(writeScript(), bashHook('git push --force'), {})
    expect(result.stdout.trim()).toBe('{}')
  })

  it('passes local commands, with or without a server round trip', async () => {
    const { env, gate } = await startGate()
    const script = writeScript()
    expect((await runHook(script, bashHook('ls'), env)).stdout.trim()).toBe('{}')
    expect((await runHook(script, bashHook('git status'), env)).stdout.trim()).toBe('{}')
    expect(gate.pending()).toEqual([])
  })

  it('holds a push until it is approved', async () => {
    const { env, gate } = await startGate()
    const running = runHook(writeScript(), bashHook('git push --force origin main'), env)
    const id = await waitForPending(gate)
    gate.decide(id, 'approved')
    expect(hookOutput((await running).stdout).permissionDecision).toBe('allow')
  })

  it('runs the edited command and denies a rejected one', async () => {
    const { env, gate } = await startGate()
    const script = writeScript()
    const edited = runHook(script, bashHook('git push --force', 'toolu_e'), env)
    gate.decide(await waitForPending(gate), 'edited', 'git push --force-with-lease')
    expect(hookOutput((await edited).stdout).updatedInput).toEqual({
      command: 'git push --force-with-lease'
    })

    const rejected = runHook(script, bashHook('ssh myserver "rm -rf /srv/app"', 'toolu_r'), env)
    gate.decide(await waitForPending(gate), 'rejected')
    expect(hookOutput((await rejected).stdout).permissionDecision).toBe('deny')
  })

  it('passes when the Orca+ it reaches has no gate route', async () => {
    const server = new AgentHookServer()
    // Why: an Orca+ build without the gate has no such route, which reads as 404.
    server.setOutgoingGateHandler(async () => null)
    await server.start({ env: 'production' })
    cleanups.push(() => server.stop())
    const result = await runHook(writeScript(), bashHook('git push --force'), server.buildPtyEnv())
    expect(result.stdout.trim()).toBe('{}')
  })

  it('denies a held call if the wait route ever answers pass', async () => {
    const server = new AgentHookServer()
    server.setOutgoingGateHandler(async (pathname) =>
      pathname.endsWith('/submit') ? 'pending held-1\n' : 'pass\n'
    )
    await server.start({ env: 'production' })
    cleanups.push(() => server.stop())
    const result = await runHook(writeScript(), bashHook('git push --force'), server.buildPtyEnv())
    expect(hookOutput(result.stdout).permissionDecision).toBe('deny')
  })

  it('finds a restarted Orca+ through the endpoint file and keeps waiting', async () => {
    const userData = tempDir()
    const db = new PulseDb(':memory:')
    cleanups.push(() => db.close())
    const gate = new OutgoingApprovalGate({ db: () => db, holdMs: 300 })
    const first = await startGate(userData, gate)
    // Native chat shape: no hook port in env, only the user-data path.
    const running = runHook(
      writeScript(),
      bashHook('git push --force'),
      { ORCA_USER_DATA_PATH: userData },
      30_000
    )
    const id = await waitForPending(gate)
    first.stop()
    await new Promise((resolve) => setTimeout(resolve, 1_000))
    await startGate(userData, gate)
    await new Promise((resolve) => setTimeout(resolve, 4_000))
    gate.decide(id, 'approved')
    expect(hookOutput((await running).stdout).permissionDecision).toBe('allow')
  }, 40_000)

  it('denies an outgoing call when Orca+ never answers', async () => {
    const result = await runHook(
      writeScript(),
      bashHook('git push --force'),
      { ORCA_AGENT_HOOK_PORT: '1', ORCA_AGENT_HOOK_TOKEN: 'x' },
      45_000
    )
    const hook = hookOutput(result.stdout)
    expect(hook.permissionDecision).toBe('deny')
    expect(hook.permissionDecisionReason).toMatch(/not reachable/)
  }, 50_000)
})

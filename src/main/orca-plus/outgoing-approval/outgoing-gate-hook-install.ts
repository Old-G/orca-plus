// Custom build (outgoing-approval): keeps exactly one PreToolUse entry for the gate in Claude's user
// settings and the script it runs in ~/.orca/agent-hooks, shared by every Orca+ instance like the status hook.
import { getConfigPath } from '../../claude/hook-settings'
import { createManagedCommandMatcher } from '../../agent-hooks/installation/commands/managed-hook-command-matching'
import { getSharedManagedScriptPath } from '../../agent-hooks/installation/scripts/managed-hook-script-path'
import { readHooksJson } from '../../agent-hooks/installation/configuration/hooks-json-read'
import { writeHooksJson } from '../../agent-hooks/installation/configuration/hooks-json-write'
import { writeManagedScript } from '../../agent-hooks/installation/scripts/managed-hook-script-write'
import type {
  HookDefinition,
  HooksConfig
} from '../../agent-hooks/installation/configuration/hook-config-schema'
import { buildOutgoingGateScript, OUTGOING_GATE_SCRIPT_FILE } from './outgoing-gate-hook-script'
import {
  buildOutgoingSentScript,
  OUTGOING_SENT_MATCHER,
  OUTGOING_SENT_SCRIPT_FILE
} from './outgoing-sent-hook-script'

const PRE_TOOL_USE = 'PreToolUse'
// Custom build (hq-request-ledger): the sent-message recorder rides beside the gate.
const POST_TOOL_USE = 'PostToolUse'
const OUTGOING_SENT_TIMEOUT_SECONDS = 10
export const OUTGOING_GATE_MATCHER = 'Bash|mcp__.*'
// Why: the agent waits until the owner presses a button; a week bounds a call nobody will ever answer.
export const OUTGOING_GATE_TIMEOUT_SECONDS = 7 * 24 * 60 * 60

export function outgoingGateHookCommand(scriptPath: string): string {
  return `/bin/sh "${scriptPath}"`
}

function withoutGateEntries(
  definitions: readonly HookDefinition[],
  scriptFile = OUTGOING_GATE_SCRIPT_FILE
): HookDefinition[] {
  const isGate = createManagedCommandMatcher(scriptFile)
  return definitions
    .map((definition) => ({
      ...definition,
      ...(Array.isArray(definition.hooks)
        ? { hooks: definition.hooks.filter((hook) => !isGate(hook.command)) }
        : {})
    }))
    .filter((definition) => !Array.isArray(definition.hooks) || definition.hooks.length > 0)
}

/** The config with one gate entry in PreToolUse and every older gate entry removed; other hooks untouched. */
export function withOutgoingGateHook(config: HooksConfig, scriptPath: string): HooksConfig {
  const others = withoutGateEntries(config.hooks?.[PRE_TOOL_USE] ?? [])
  const gate: HookDefinition = {
    matcher: OUTGOING_GATE_MATCHER,
    hooks: [
      {
        type: 'command',
        command: outgoingGateHookCommand(scriptPath),
        timeout: OUTGOING_GATE_TIMEOUT_SECONDS
      }
    ]
  }
  return { ...config, hooks: { ...config.hooks, [PRE_TOOL_USE]: [...others, gate] } }
}

/** Custom build (hq-request-ledger): the config with one sent-recorder entry in PostToolUse. */
export function withOutgoingSentHook(config: HooksConfig, scriptPath: string): HooksConfig {
  const others = withoutGateEntries(config.hooks?.[POST_TOOL_USE] ?? [], OUTGOING_SENT_SCRIPT_FILE)
  const sent: HookDefinition = {
    matcher: OUTGOING_SENT_MATCHER,
    hooks: [
      {
        type: 'command',
        command: outgoingGateHookCommand(scriptPath),
        timeout: OUTGOING_SENT_TIMEOUT_SECONDS
      }
    ]
  }
  return { ...config, hooks: { ...config.hooks, [POST_TOOL_USE]: [...others, sent] } }
}

export function installOutgoingGateHook(
  configPath = getConfigPath(),
  scriptPath = getSharedManagedScriptPath(OUTGOING_GATE_SCRIPT_FILE),
  sentScriptPath = getSharedManagedScriptPath(OUTGOING_SENT_SCRIPT_FILE)
): boolean {
  // Why: the gate is a POSIX sh script; Windows needs its own launcher before it can be held there.
  if (process.platform === 'win32') {
    return false
  }
  const config = readHooksJson(configPath)
  if (!config) {
    // Why: an unreadable settings.json must not be overwritten with a fresh one.
    console.warn('[outgoing-approval] Claude settings.json unreadable; gate hook not installed')
    return false
  }
  writeManagedScript(scriptPath, buildOutgoingGateScript())
  writeManagedScript(sentScriptPath, buildOutgoingSentScript())
  const next = withOutgoingSentHook(withOutgoingGateHook(config, scriptPath), sentScriptPath)
  if (JSON.stringify(next) !== JSON.stringify(config)) {
    writeHooksJson(configPath, next)
  }
  return true
}

/** Removes the gate and recorder entries; the scripts stay, inert, since no entry runs them. */
export function removeOutgoingGateHook(configPath = getConfigPath()): void {
  const config = readHooksJson(configPath)
  if (!config?.hooks) {
    return
  }
  const hooks = { ...config.hooks }
  for (const [event, file] of [
    [PRE_TOOL_USE, OUTGOING_GATE_SCRIPT_FILE],
    [POST_TOOL_USE, OUTGOING_SENT_SCRIPT_FILE]
  ] as const) {
    const remaining = withoutGateEntries(hooks[event] ?? [], file)
    if (remaining.length > 0) {
      hooks[event] = remaining
    } else {
      delete hooks[event]
    }
  }
  if (JSON.stringify(hooks) !== JSON.stringify(config.hooks)) {
    writeHooksJson(configPath, { ...config, hooks })
  }
}

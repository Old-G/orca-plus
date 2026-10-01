// Custom build (outgoing-approval): keeps exactly one PreToolUse entry for the gate in Claude's user
// settings and the script it runs in ~/.orca/agent-hooks, shared by every Orca+ instance like the status hook.
import { getConfigPath } from '../../claude/hook-settings'
import {
  createManagedCommandMatcher,
  getSharedManagedScriptPath,
  readHooksJson,
  writeHooksJson,
  writeManagedScript,
  type HookDefinition,
  type HooksConfig
} from '../../agent-hooks/installer-utils'
import { buildOutgoingGateScript, OUTGOING_GATE_SCRIPT_FILE } from './outgoing-gate-hook-script'

const PRE_TOOL_USE = 'PreToolUse'
export const OUTGOING_GATE_MATCHER = 'Bash|mcp__.*'
// Why: the agent waits until the owner presses a button; a week bounds a call nobody will ever answer.
export const OUTGOING_GATE_TIMEOUT_SECONDS = 7 * 24 * 60 * 60

export function outgoingGateHookCommand(scriptPath: string): string {
  return `/bin/sh "${scriptPath}"`
}

function withoutGateEntries(definitions: readonly HookDefinition[]): HookDefinition[] {
  const isGate = createManagedCommandMatcher(OUTGOING_GATE_SCRIPT_FILE)
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

export function installOutgoingGateHook(
  configPath = getConfigPath(),
  scriptPath = getSharedManagedScriptPath(OUTGOING_GATE_SCRIPT_FILE)
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
  const next = withOutgoingGateHook(config, scriptPath)
  if (JSON.stringify(next) !== JSON.stringify(config)) {
    writeHooksJson(configPath, next)
  }
  return true
}

/** Removes the gate entry; the script stays, inert, since no entry runs it. */
export function removeOutgoingGateHook(configPath = getConfigPath()): void {
  const config = readHooksJson(configPath)
  const existing = config?.hooks?.[PRE_TOOL_USE]
  if (!config || !existing) {
    return
  }
  const remaining = withoutGateEntries(existing)
  if (
    remaining.length !== existing.length ||
    JSON.stringify(remaining) !== JSON.stringify(existing)
  ) {
    writeHooksJson(configPath, { ...config, hooks: { ...config.hooks, [PRE_TOOL_USE]: remaining } })
  }
}

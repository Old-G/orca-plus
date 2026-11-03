// Custom build (claude-connector-gap): claude.ai connectors are kept per Claude account, so a chat moved
// to another account after a limit loses every connector that account never connected (owner, 04.11:
// «I switch the account and the connectors fall off»). After a switch the two accounts' connectors
// are compared and the bell names the ones the new account lacks.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PULSE_BELL_ACTION, PULSE_BELL_KIND, type PulseBellInput } from '../../shared/pulse-bell'
import { runClaudeCommandProcess } from './claude-command-process'

export const CLAUDE_CONNECTOR_GAP_KIND = PULSE_BELL_KIND.claudeConnectorGap

const CLAUDE_AI_PREFIX = 'claude.ai '
// Why: `claude mcp list` health-checks every server, local ones too; a slow one must not hang the check.
const MCP_LIST_TIMEOUT_MS = 150_000

/** claude.ai connector name → connected now, from `claude mcp list`. */
export function parseClaudeAiConnectors(output: string): Map<string, boolean> {
  const connectors = new Map<string, boolean>()
  for (const line of output.split('\n')) {
    if (!line.startsWith(CLAUDE_AI_PREFIX)) {
      continue
    }
    // Why: names hold spaces and dashes («Fathom – Your Meeting…»), the URL after them holds a colon.
    const nameEnd = line.indexOf(': ')
    if (nameEnd === -1) {
      continue
    }
    connectors.set(line.slice(CLAUDE_AI_PREFIX.length, nameEnd), line.includes('✔ Connected'))
  }
  return connectors
}

/** Connectors working on the account left and not working on the one switched to, sorted. */
export function claudeConnectorGap(
  previous: ReadonlyMap<string, boolean>,
  next: ReadonlyMap<string, boolean>
): string[] {
  return [...previous]
    .filter(([name, connected]) => connected && next.get(name) !== true)
    .map(([name]) => name)
    .sort((a, b) => a.localeCompare(b))
}

export function claudeConnectorGapBellItem(
  accountLabel: string,
  missing: readonly string[]
): PulseBellInput {
  return {
    kind: CLAUDE_CONNECTOR_GAP_KIND,
    title:
      missing.length === 1
        ? `${accountLabel}: 1 connector is not connected`
        : `${accountLabel}: ${missing.length} connectors are not connected`,
    body: `${missing.join(', ')}. Chats on this account can't use them — connect them at claude.ai → Customize → Connectors, signed in to this account.`,
    urgency: 'urgent',
    refKind: CLAUDE_CONNECTOR_GAP_KIND,
    refId: null,
    actions: [{ id: PULSE_BELL_ACTION.dismiss, label: 'Got it' }],
    dedupeKey: `${CLAUDE_CONNECTOR_GAP_KIND}:${accountLabel}:${missing.join('|')}`
  }
}

export async function readClaudeAiConnectors(configDir: string): Promise<Map<string, boolean>> {
  const output = await runClaudeCommandProcess(
    ['mcp', 'list'],
    { windowsPath: configDir, linuxPath: null, wslDistro: null },
    MCP_LIST_TIMEOUT_MS
  )
  return parseClaudeAiConnectors(output)
}

export type ClaudeConnectorGapDeps = {
  readConnectors: (configDir: string) => Promise<Map<string, boolean>>
  accountLabel: (configDir: string) => string
  syncBell: (items: PulseBellInput[]) => void
  log: (message: string) => void
}

/** Compares the folder chats ran in with the one they run in now; a gap goes to the bell. */
export async function checkClaudeConnectorGap(
  deps: ClaudeConnectorGapDeps,
  previousDir: string,
  nextDir: string
): Promise<string[]> {
  if (previousDir === nextDir) {
    return []
  }
  const [previous, next] = await Promise.all([
    deps.readConnectors(previousDir),
    deps.readConnectors(nextDir)
  ])
  const missing = claudeConnectorGap(previous, next)
  deps.log(`connectors missing on the new account: ${missing.join(', ') || 'none'}`)
  deps.syncBell(
    missing.length > 0 ? [claudeConnectorGapBellItem(deps.accountLabel(nextDir), missing)] : []
  )
  return missing
}

/** The account's organization as the CLI signed in there names it, else the folder. */
export function claudeAccountLabelOfDir(configDir: string): string {
  try {
    const config: unknown = JSON.parse(readFileSync(join(configDir, '.claude.json'), 'utf8'))
    const account: unknown =
      config && typeof config === 'object' ? Reflect.get(config, 'oauthAccount') : null
    const org: unknown =
      account && typeof account === 'object' ? Reflect.get(account, 'organizationName') : null
    if (typeof org === 'string' && org) {
      return org
    }
  } catch {
    // Why: a folder never signed in has no config yet; its path still tells the accounts apart.
  }
  return configDir
}

export function checkConnectorGapAfterSwitch(
  runtime: { pulseSyncInboxKind: (kind: string, items: PulseBellInput[]) => void },
  previousDir: string,
  nextDir: string
): Promise<string[]> {
  return checkClaudeConnectorGap(
    {
      readConnectors: readClaudeAiConnectors,
      accountLabel: claudeAccountLabelOfDir,
      syncBell: (items) => runtime.pulseSyncInboxKind(CLAUDE_CONNECTOR_GAP_KIND, items),
      log: (message) => console.log('[claude-connector-gap]', message)
    },
    previousDir,
    nextDir
  )
}

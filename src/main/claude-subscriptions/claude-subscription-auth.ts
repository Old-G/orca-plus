import { runClaudeCommandProcess } from '../claude-accounts/claude-command-process'
import type { ClaudeSubscriptionStatus } from '../../shared/claude-subscriptions'
import { prepareClaudeSubscriptionHome } from './claude-subscription-home'

const STATUS_TIMEOUT_MS = 20_000
const LOGIN_TIMEOUT_MS = 10 * 60 * 1000

type RunCommand = typeof runClaudeCommandProcess

function hostConfig(configDir: string) {
  return { windowsPath: configDir, linuxPath: null, wslDistro: null }
}

/** Reads `claude auth status --json` for a subscription dir; the CLI touches the keychain, Orca
 *  only sees the identity fields. */
export function parseClaudeSubscriptionStatus(output: string): ClaudeSubscriptionStatus {
  try {
    const parsed: unknown = JSON.parse(output)
    if (!parsed || typeof parsed !== 'object') {
      return { loggedIn: false }
    }
    const fields = new Map<string, unknown>(Object.entries(parsed))
    const text = (key: string): string | undefined => {
      const value = fields.get(key)
      return typeof value === 'string' && value ? value : undefined
    }
    return {
      loggedIn: fields.get('loggedIn') === true,
      email: text('email'),
      orgName: text('orgName'),
      subscriptionType: text('subscriptionType')
    }
  } catch {
    return { loggedIn: false }
  }
}

export async function readClaudeSubscriptionStatus(
  configDir: string,
  runCommand: RunCommand = runClaudeCommandProcess
): Promise<ClaudeSubscriptionStatus> {
  const output = await runCommand(
    ['auth', 'status', '--json'],
    hostConfig(configDir),
    STATUS_TIMEOUT_MS,
    {
      allowFailure: true
    }
  )
  return parseClaudeSubscriptionStatus(output)
}

/** Browser sign-in straight into the subscription dir; the CLI keeps the tokens there. */
export async function loginClaudeSubscription(
  configDir: string,
  runCommand: RunCommand = runClaudeCommandProcess
): Promise<ClaudeSubscriptionStatus> {
  prepareClaudeSubscriptionHome(configDir)
  await runCommand(['auth', 'login', '--claudeai'], hostConfig(configDir), LOGIN_TIMEOUT_MS, {
    keepStdinOpen: true
  })
  return readClaudeSubscriptionStatus(configDir, runCommand)
}

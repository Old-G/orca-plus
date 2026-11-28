// Custom build (hq-task-lock, A3 28.11): the CLI side of the plan-row lock. Before `orca agent launch`
// or `orca worktree create --agent` starts anything, the row its brief names (or `--task`) is claimed
// in Orca+; a row whose chat is open refuses the launch with that chat's address. After the start the
// new chat is bound to the row; a failed or terminal start releases it. An older host, a remote one or
// a lock error never stops a launch — it starts as before and says the row is not locked.
import type { AgentLaunchResult } from '../shared/agent-launch/contracts/agent-launch-intent'
import { readInjectedAgentSessionId } from '../shared/agent-session/lifecycle/launch/agent-session-caller-env'
import {
  hqBriefHoldsARow,
  hqTaskLabel,
  hqTaskOfBrief,
  hqTaskRefusalText,
  parseHqTaskFlag,
  type HqTaskClaimResult,
  type HqTaskKey
} from '../shared/hq-task-lock'
import type { RuntimeClient } from './runtime/client'
import { RuntimeClientError } from './runtime/connection/types'

type LockClient = Pick<RuntimeClient, 'call' | 'isRemote'>

export type HqTaskLockHold = {
  key: HqTaskKey
  /** Custom build (hq-task-lock, D1): the calling chat holds the row and this launch is its next chat;
   *  the launch links it as the caller's handoff, so the old chat is parked, not left live beside it. */
  continuesOwnRow: boolean
  /** Binds the started chat to the row; a launch that started no chat releases it. */
  started: (result: Pick<AgentLaunchResult, 'outcome'>) => Promise<void>
  /** The launch failed: frees the row for the next launch. */
  failed: () => Promise<void>
}

function note(line: string): void {
  // Why stderr: --json output stays one parseable document.
  console.error(line)
}

/** The row this launch takes: `--task` wins, else the brief's task file; null for none. */
export function hqTaskOfLaunch(
  flags: Map<string, string | boolean>,
  promptText: string | undefined
): HqTaskKey | null {
  const flag = flags.get('task')
  if (flag === true || flag === '') {
    throw new RuntimeClientError('invalid_argument', '--task takes <plan>:<row>, or none')
  }
  if (typeof flag === 'string') {
    try {
      return parseHqTaskFlag(flag)
    } catch (error) {
      throw new RuntimeClientError('invalid_argument', (error as Error).message)
    }
  }
  const key = hqTaskOfBrief(promptText)
  // Custom build (hq-task-lock, D1 28.11): a worker launched without its row is the duplicate the lock
  // cannot see (retro orca-ux: an untasked launch sat open beside the real worker); refuse, and let
  // `--task none` start it unlocked on purpose.
  if (!key && promptText && hqBriefHoldsARow(promptText)) {
    throw new RuntimeClientError(
      'task_required',
      'This worker brief names no plan row («Ход — в runs/<plan>/<row>.md»), so Orca+ cannot stop a second chat of it. Pass --task <plan>:<row>, or --task none to start it unlocked.'
    )
  }
  return key
}

/**
 * Claims the launch's row. Throws when its chat is open or another launch is starting it; returns null
 * when there is no row or the host cannot lock.
 */
export async function claimHqTaskLock(
  client: LockClient,
  flags: Map<string, string | boolean>,
  launch: { prompt?: { text: string } }
): Promise<HqTaskLockHold | null> {
  const key = hqTaskOfLaunch(flags, launch.prompt?.text)
  if (!key) {
    return null
  }
  if (client.isRemote) {
    note(`${hqTaskLabel(key)} is not locked: the lock is kept by the local Orca+ only.`)
    return null
  }
  // Why a --retry-launch replay claims too: its first try released the row when the reply was lost,
  // and the chat it started is bound only here (review A3).
  const callerSessionId = readInjectedAgentSessionId() ?? undefined
  let claimed: HqTaskClaimResult
  try {
    const response = await client.call<HqTaskClaimResult>('hq.taskLock', {
      action: 'claim',
      ...key,
      ...(callerSessionId ? { callerSessionId } : {})
    })
    claimed = response.result
  } catch (error) {
    note(`warning: ${hqTaskLabel(key)} is not locked: ${(error as Error).message}`)
    return null
  }
  if (!claimed.taken) {
    throw new RuntimeClientError('task_locked', hqTaskRefusalText(key, claimed, Date.now()), {
      task: key,
      reason: claimed.reason,
      holder: claimed.holder
    })
  }
  const { ticket, movedFrom } = claimed
  const continuesOwnRow = claimed.own === true
  if (movedFrom) {
    note(
      `${hqTaskLabel(key)}: lock moves from ${movedFrom.address ?? '(no address)'} (${movedFrom.sessionId})${continuesOwnRow ? '; this chat hands its row on and Orca+ parks it — end your turn after the launch' : ''}.`
    )
  }
  const release = async (): Promise<void> => {
    try {
      await client.call('hq.taskLock', { action: 'release', ...key, ticket })
    } catch {
      // Why: the row frees itself after a while; the launch's own error is the one to show.
    }
  }
  return {
    key,
    continuesOwnRow,
    started: async (result) => {
      if (result.outcome.kind !== 'structured') {
        note(`${hqTaskLabel(key)} is not locked: the agent started in a terminal, not a chat.`)
        await release()
        return
      }
      try {
        const bound = await client.call<{ bound: boolean }>('hq.taskLock', {
          action: 'bind',
          ...key,
          ticket,
          sessionId: result.outcome.sessionId
        })
        if (!bound.result.bound) {
          note(
            `warning: ${hqTaskLabel(key)} was claimed again meanwhile; this chat does not hold it.`
          )
        }
      } catch (error) {
        note(
          `warning: ${hqTaskLabel(key)} is not locked to the new chat: ${(error as Error).message}`
        )
      }
    },
    failed: release
  }
}

/** Runs `launch` holding the row: binds what it started, releases on a throw. */
export async function withHqTaskLock<T extends { result: Pick<AgentLaunchResult, 'outcome'> }>(
  hold: HqTaskLockHold | null,
  launch: () => Promise<T>
): Promise<T> {
  if (!hold) {
    return launch()
  }
  let launched: T
  try {
    launched = await launch()
  } catch (error) {
    await hold.failed()
    throw error
  }
  await hold.started(launched.result)
  return launched
}

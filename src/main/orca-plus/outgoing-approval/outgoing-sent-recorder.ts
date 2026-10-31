// Custom build (hq-request-ledger): what the sent-message hook reports becomes the sending chat's
// message in the request ledger, at the place the call's result names.
import { execFile } from 'node:child_process'
import type { PulseDb } from '../pulse/pulse-db'
import { outgoingSentMessages, readOutgoingSentHook, type RepoOfCwd } from './outgoing-sent-calls'
import { repoOfGitRemote } from './outgoing-sent-glab'
import type { OutgoingSentReport } from './outgoing-gate-http'

export type OutgoingSentRecorderDeps = {
  db: () => PulseDb
  repoOfCwd: RepoOfCwd
  /** The HQ project of the sending chat, by its workspace or folder; null when HQ knows none. */
  projectOf: (chat: { sessionId: string | null; cwd: string | null }) => Promise<string | null>
  now: () => number
}

/** True when the call sent a message and it is in the ledger. */
export async function recordOutgoingSent(
  deps: OutgoingSentRecorderDeps,
  report: OutgoingSentReport
): Promise<boolean> {
  const hook = readOutgoingSentHook(report.hook)
  const sent = hook ? await outgoingSentMessages(hook, deps.repoOfCwd) : []
  if (!hook || sent.length === 0) {
    return false
  }
  const sessionId = report.agentSessionId?.trim() || null
  const project = await deps.projectOf({ sessionId, cwd: hook.cwd }).catch(() => null)
  for (const message of sent) {
    deps.db().recordAgentSend({
      key: message.key,
      ts: message.ts,
      at: message.at ?? deps.now(),
      text: message.text,
      link: message.link,
      title: message.title,
      project,
      sessionId,
      call: { sessionId: hook.sessionId, toolUseId: hook.toolUseId }
    })
  }
  return true
}

/** The repo the folder's `origin` remote names, as glab would pick it. */
export function gitRepoOfCwd(cwd: string): Promise<string | null> {
  return new Promise((resolve) => {
    execFile('git', ['-C', cwd, 'remote', 'get-url', 'origin'], { timeout: 3_000 }, (error, out) =>
      resolve(error ? null : repoOfGitRemote(String(out)))
    )
  })
}

// Custom build (hq-router two marks, owner 28.11): a message the owner marked 🆕 is new work — a new
// chat starts for it by itself, in the project the card guessed (none → the HQ workspace), with the
// message in the first turn; the Slack thread then belongs to that chat.
import { hqIntakePrompt, type HqIntake } from '../../shared/hq-slack-intake'

export type HqNewMarkChatDeps = {
  /** The workspace of the card's project (its repo), or HQ's own when there is none; null when not open in Orca. */
  workspaceFor: (repoId: string | null) => { worktreeId: string; name: string } | null
  /** An empty chat: the message goes in only after `limit`. */
  launch: (
    worktreeId: string
  ) => Promise<{ ok: true; sessionId: string } | { ok: false; error: string }>
  /** True once the chat runs in Auto — the card quotes other people's words, so never Full access. */
  limit: (sessionId: string) => Promise<boolean>
  deliver: (sessionId: string, prompt: string) => Promise<boolean>
  /** Keeps the thread with the new chat (the existing thread binding) and logs the choice. */
  bind: (intake: HqIntake, sessionId: string) => void
}

/** The turn the new chat opens with: who wrote, the link, the text — and that it is new work. */
export function hqNewMarkPrompt(intake: HqIntake, projectName: string | null): string {
  return `${hqIntakePrompt(intake, { projectName, note: '' })}\nThe user marked it 🆕: this is new work, not a part of anything already going.`
}

/** True once the chat started, took the message and the thread is bound to it. Never throws. */
export async function startHqNewMarkChat(
  intake: HqIntake,
  deps: HqNewMarkChatDeps
): Promise<boolean> {
  const workspace = deps.workspaceFor(intake.repoId)
  if (!workspace) {
    return false
  }
  const launched = await deps.launch(workspace.worktreeId).catch(() => null)
  if (!launched?.ok) {
    return false
  }
  if (!(await deps.limit(launched.sessionId).catch(() => false))) {
    return false
  }
  const prompt = hqNewMarkPrompt(intake, intake.project ?? workspace.name)
  if (!(await deps.deliver(launched.sessionId, prompt).catch(() => false))) {
    return false
  }
  // Why: the chat is running with the message in it; a binding that fails must not read as a failed start.
  try {
    deps.bind(intake, launched.sessionId)
  } catch (error) {
    console.warn('[hq-router] new-mark thread not bound', error)
  }
  return true
}

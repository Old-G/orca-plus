// Custom build (hq-reply-auto, owner 25.11): GitLab's own word on an MR a chat waits for passes to that
// chat by itself — a fact the Orca+ MR watch read from GitLab, not a person's words to weigh.
import { HQ_GITLAB_AUTHOR_ID } from './hq-mr-watch'
import type { PulseWaiting } from './pulse-types'

const GITLAB_MR =
  /^https:\/\/gitlab\.com\/((?:[\w.-]+\/)+?[\w.-]+)\/-\/merge_requests\/(\d+)(?:[/?#]|$)/i
// Why: the watch writes this line itself from GitLab's state (hqMrOutcome); «closed without merging»
// is not in it — an MR dropped unmerged is the owner's call.
const GITLAB_DONE = /^GitLab: MR !(\d+) \([^)]+\) (?:merged|approved by)\b/

function gitlabMr(link: string | null | undefined): string | null {
  const match = GITLAB_MR.exec(link ?? '')
  return match ? `${(match[1] ?? '').toLowerCase()}!${match[2]}` : null
}

/**
 * Custom build (hq-reply-auto, owner 25.11): GitLab's own word that the very MR the chat asked about
 * is merged or approved. The Orca+ MR watch wrote it from GitLab's state, so no model needs to read it.
 */
export function hqReplyGitLabDone(
  waiting: Pick<PulseWaiting, 'replyAuthorId' | 'reply' | 'replyLink' | 'sourceRef'>
): boolean {
  const asked = gitlabMr(waiting.sourceRef)
  const said = gitlabMr(waiting.replyLink)
  const iid = GITLAB_DONE.exec(waiting.reply ?? '')?.[1]
  return (
    waiting.replyAuthorId === HQ_GITLAB_AUTHOR_ID &&
    asked !== null &&
    asked === said &&
    iid !== undefined &&
    said.endsWith(`!${iid}`)
  )
}

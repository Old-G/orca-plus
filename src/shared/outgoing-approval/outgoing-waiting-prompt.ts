// Custom build (hq-waiting-replies): what an approved Slack message tells its agent — record what it
// now waits for, so HQ → Notes lists it and the person's answer comes back to this chat.
import { readInputString, type OutgoingDraftCall } from './outgoing-action'

export const WAITING_SOURCE_SLACK = 'slack'
export const WAITING_SOURCE_CLICKUP = 'clickup'

/** Custom build (hq-clickup-waiting): a question asked in a task comment is waited for the same way. */
function clickUpCommentFollowUp(target: string | null): string {
  const task = target?.trim() || '<the task id>'
  return [
    'Orca+: once this ClickUp comment is posted, decide whether it asks someone for something —',
    'an answer, a decision, data, a review or work. If it does, record what you now wait for, so the',
    'user sees it in HQ → Notes and the answer is brought back to this chat:',
    `orca pulse wait add --direction on-them --person "<recipient's name>"` +
      ` --title "<what you wait for, one line, in the user's language>" --source ${WAITING_SOURCE_CLICKUP}` +
      ` --source-ref "clickup:${task}:<the new comment's id from the tool result>"`,
    'Skip this when the comment only informs, answers or thanks.'
  ].join('\n')
}

/** Null for anything but a Slack message or a ClickUp comment. */
export function outgoingWaitingFollowUp(
  call: OutgoingDraftCall,
  target: string | null
): string | null {
  if (/clickup/i.test(call.service) && /\bcomment\b/.test(call.operation)) {
    return clickUpCommentFollowUp(target)
  }
  if (!/slack/i.test(call.service) || !/\b(send|reply|schedule)\b/.test(call.operation)) {
    return null
  }
  const target0 = target?.split(',')[0]?.trim() || null
  // Why: a DM sent to a user id lands in a D… channel only the tool result names.
  const channel = target0 && /^[CDG]/.test(target0) ? target0 : null
  const threadTs = readInputString(call.toolInput, 'thread_ts')
  // Why: a reply's own link may not name its thread's root, so a known thread is spelled out.
  const sourceRef =
    channel && threadTs
      ? `slack:${channel}:${threadTs}`
      : '<the message link from the tool result, or slack:<channel id>:<message ts>>'
  const where = channel
    ? `The channel is ${channel}.`
    : 'Take the channel id and the message ts from the tool result.'
  return [
    'Orca+: once this Slack message is sent, decide whether it asks the recipient for something —',
    'an answer, a decision, data, a review or work. If it does, record what you now wait for, so the',
    'user sees it in HQ → Notes and the answer is brought back to this chat:',
    `orca pulse wait add --direction on-them --person "<recipient's name>"` +
      ` --title "<what you wait for, one line, in the user's language>" --source ${WAITING_SOURCE_SLACK}` +
      ` --source-ref "${sourceRef}"`,
    `${where} Skip this when the message only informs, answers or thanks.`
  ].join('\n')
}

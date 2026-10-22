// Custom build (hq-mail-intake): what a GitLab or ClickUp notification email is about. The email is
// only a signal: it names the MR, task or comment, and Orca+ reads the truth from their own APIs.

/** The notification senders Orca+ reads; everything else in the mailbox is left alone. */
export const HQ_MAIL_SENDERS = [
  'gitlab@mg.gitlab.com',
  'notifications@tasks.clickup.com',
  'notifications@clickup.com'
] as const

export type HqMail = {
  id: string
  from: string
  subject: string
  /** text/plain part, or the HTML when the email has none. */
  body: string
  receivedAt: number
}

export type HqMailEvent =
  | { kind: 'mr-merged'; mrUrl: string; host: string; projectPath: string; iid: number }
  | { kind: 'clickup-comment'; taskRef: string; commentId: string }
  | { kind: 'clickup-task'; taskRef: string; action: 'shared' | 'assigned' }

/** `GitLab <gitlab@mg.gitlab.com>` → `gitlab@mg.gitlab.com`. */
export function hqMailAddress(from: string): string {
  // Why: the addr-spec is the last <…>; a display name can carry a fake one before it.
  const match = /<([^<>]+)>\s*$/.exec(from)
  return (match?.[1] ?? from).trim().toLowerCase()
}

// Why: the body is someone else's text; a cap keeps every regex below linear and cheap.
const BODY_MAX = 200_000

// Why: ClickUp wraps every link in up to three layers of tracking redirects, each URL-encoded again.
function unwrapLinks(text: string): string {
  let out = text
  for (let pass = 0; pass < 3; pass += 1) {
    out = out.replace(/%([0-9A-Fa-f]{2})/g, (_, hex: string) =>
      String.fromCharCode(Number.parseInt(hex, 16))
    )
  }
  return out
}

const MR_URL = /https:\/\/([a-z0-9.-]+)\/((?:[\w.-]+\/)+?[\w.-]+)\/-\/merge_requests\/(\d+)/i

function gitLabEvent(mail: HqMail): HqMailEvent | null {
  const iid = /Merge request !(\d+) was merged/.exec(mail.body)?.[1]
  const url = MR_URL.exec(mail.body)
  if (!iid || !url || url[3] !== iid) {
    return null
  }
  return {
    kind: 'mr-merged',
    mrUrl: url[0],
    host: (url[1] ?? '').toLowerCase(),
    projectPath: url[2] ?? '',
    iid: Number(iid)
  }
}

// Why: status changes, overdue reminders, digests and the agents' Slack mirror are not requests.
const CLICKUP_NOISE = /\[Slack Sync\]|set the status to|Task Overdue|^\[Overdue\]|Daily Summary/m

const CLICKUP_TASK_LINK =
  /https:\/\/app\.clickup\.com\/t\/(?:\d+\/)?([A-Za-z0-9][A-Za-z0-9_-]*)(?:\?comment=(\d+))?/g

function clickUpEvent(mail: HqMail): HqMailEvent | null {
  if (CLICKUP_NOISE.test(mail.subject) || CLICKUP_NOISE.test(mail.body)) {
    return null
  }
  const links = [...unwrapLinks(mail.body).matchAll(CLICKUP_TASK_LINK)]
  const marked = {
    task: /task_id_start-([A-Za-z0-9_-]+?)-task_id_end/.exec(mail.body)?.[1],
    comment: /comment_id_start-(\d+)-comment_id_end/.exec(mail.body)?.[1]
  }
  const taskRef = marked.task ?? links[0]?.[1]
  if (!taskRef) {
    return null
  }
  // Why: who shared or assigned is not taken from the email — anyone can write those words.
  if (mail.subject.trim().endsWith(' shared a task with you')) {
    return { kind: 'clickup-task', taskRef, action: 'shared' }
  }
  if (
    mail.body.split('\n').some((line) => line.length < 300 && line.includes('assigned task to you'))
  ) {
    return { kind: 'clickup-task', taskRef, action: 'assigned' }
  }
  if (marked.task && marked.comment) {
    return { kind: 'clickup-comment', taskRef: marked.task, commentId: marked.comment }
  }
  // Why: a comment can link other tasks; the «View comment» link is the one with the comment id.
  const comment = links.find((link) => link[2])
  return comment?.[1] && comment[2]
    ? { kind: 'clickup-comment', taskRef: comment[1], commentId: comment[2] }
    : null
}

/** One event per email, or null when the email is not one Orca+ acts on. */
export function hqMailEvent(input: HqMail): HqMailEvent | null {
  const mail = { ...input, body: input.body.slice(0, BODY_MAX) }
  const sender = hqMailAddress(mail.from)
  if (sender === 'gitlab@mg.gitlab.com') {
    return gitLabEvent(mail)
  }
  if (sender.endsWith('@tasks.clickup.com') || sender === 'notifications@clickup.com') {
    return clickUpEvent(mail)
  }
  return null
}

/** The same MR whatever tail a link carries (`/diffs`, `#note_1`, a trailing slash). */
export function hqMergeRequestKey(url: string): string | null {
  const match = MR_URL.exec(url)
  return match ? `${match[1]?.toLowerCase()}/${match[2]?.toLowerCase()}!${match[3]}` : null
}

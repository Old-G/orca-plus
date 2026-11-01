// Custom build (hq-request-ledger): which tasks and MRs a message is about, so a DM about another
// task does not land in an old talk or under an old question.
const TASK_LINK = /app\.clickup\.com\/t\/(?:\d+\/)?([\w-]+)|merge_requests\/(\d+)/g
const TASK_ID = /\b[A-Z][A-Z0-9]+-\d+\b/g

/** Tasks and MRs a text links to, e.g. `DEV-18421`, `!314`; a bare mention is not a link. */
export function linkedIn(text: string): Set<string> {
  return new Set(
    [...text.matchAll(TASK_LINK)].map((match) => (match[1] ? match[1] : `!${match[2]}`))
  )
}

/** Links plus bare task IDs, e.g. «DEV-2 next». */
export function namedIn(text: string): Set<string> {
  return new Set([...linkedIn(text), ...(text.match(TASK_ID) ?? [])])
}

/** Whether refs name a task `own` is not about — or, naming no task, only MRs it is not about. Why
 *  every task and not some: a DM that names its own task and another one (01.11 Codex review) is not
 *  only about the old one. */
export function namesOtherTask(refs: Set<string>, own: string): boolean {
  const tasks = [...refs].filter((ref) => !ref.startsWith('!'))
  if (tasks.length > 0) {
    return tasks.some((ref) => !own.includes(ref))
  }
  return refs.size > 0 && ![...refs].some((ref) => own.includes(ref))
}

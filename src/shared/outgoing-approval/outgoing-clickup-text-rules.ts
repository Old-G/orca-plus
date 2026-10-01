// Custom build (outgoing-approval): an existing ClickUp task's name and description are never rewritten
// by an agent (team rule), so a write that would do it is held even though other task writes pass.

const TASK_TEXT_FIELDS = new Set([
  'name',
  'description',
  'markdown_description',
  'markdown_content'
])

export function rewritesClickUpTaskText(server: string, tool: string, input: unknown): boolean {
  return (
    /clickup/i.test(server) &&
    tool === 'clickup_update_task' &&
    Object.keys(input && typeof input === 'object' ? input : {}).some((key) =>
      TASK_TEXT_FIELDS.has(key)
    )
  )
}

const CLICKUP_TASK_URL = /^https?:\/\/api\.clickup\.com\/api\/v2\/task\/[\w$\-{}]+(?:\?\S*)?$/i

const TASK_TEXT_IN_BODY = /name|description|markdown/i

/** A curl that writes one ClickUp task itself (not its comments or tags) with a body that names its text. */
export function curlRewritesClickUpTaskText(segment: string): boolean {
  const urls = segment.match(/https?:\/\/[^\s'"]+/g) ?? []
  if (!urls.some((url) => CLICKUP_TASK_URL.test(url))) {
    return false
  }
  // Why: a body from a file, stdin or a variable cannot be checked, so only single-quoted literals pass.
  const bodies = [...segment.matchAll(/(?:\s-d|--data[\w-]*|--json)\s*(?:'([^']*)'|(\S+))/g)]
  return bodies.some((match) => match[1] === undefined || TASK_TEXT_IN_BODY.test(match[1]))
}

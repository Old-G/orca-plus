// Custom build (outgoing-approval): ClickUp's generic operator tool runs any `<model>.<operator>` pair,
// so the same holds apply to what it is asked to run: deletes, merges, chat messages, task text rewrites.

// Why: a merge folds the source tasks into the target and removes them.
const DESTRUCTIVE_OPERATORS = new Set(['delete', 'delete_many', 'merge'])

const TASK_TEXT_KEY = /^(?:name|description|markdown_description|markdown_content)$/

function field(input: unknown, key: string): unknown {
  return input && typeof input === 'object' ? Reflect.get(input, key) : undefined
}

function namesTaskText(body: unknown): boolean {
  if (Array.isArray(body)) {
    return body.some(namesTaskText)
  }
  if (!body || typeof body !== 'object') {
    return false
  }
  return Object.entries(body).some(
    ([key, value]) => TASK_TEXT_KEY.test(key) || namesTaskText(value)
  )
}

export function heldClickUpOperatorCall(server: string, tool: string, input: unknown): boolean {
  if (!/clickup/i.test(server) || tool !== 'clickup_execute_operator') {
    return false
  }
  const operator = String(field(input, 'operator') ?? '')
  const model = String(field(input, 'model') ?? '')
  if (DESTRUCTIVE_OPERATORS.has(operator)) {
    return true
  }
  if (/chat|message/i.test(model) && operator.startsWith('create')) {
    return true
  }
  return /task/i.test(model) && operator.startsWith('update') && namesTaskText(field(input, 'body'))
}

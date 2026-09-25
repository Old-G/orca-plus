export type ClickUpTaskReference = {
  id: string
  /** True for a workspace custom id such as DEV-123. */
  custom: boolean
}

const CUSTOM_ID_RE = /^[A-Za-z][A-Za-z0-9]*-\d+$/
// Why: native task ids are short lowercase base-36 strings (86cbcnw23); a digit
// requirement keeps plain words from being sent as id lookups.
const TASK_ID_RE = /^(?=[0-9a-z]*\d)(?=[0-9a-z]*[a-z])[0-9a-z]{6,16}$/

function referenceFromSegment(segment: string): ClickUpTaskReference | null {
  if (CUSTOM_ID_RE.test(segment)) {
    return { id: segment.toUpperCase(), custom: true }
  }
  return TASK_ID_RE.test(segment) ? { id: segment, custom: false } : null
}

/** Parses https://app.clickup.com/t/<id>, /t/<workspace>/<custom-id>, DEV-123 or a task id. */
export function parseClickUpTaskReference(input: string): ClickUpTaskReference | null {
  const trimmed = input.trim()
  if (!trimmed) {
    return null
  }
  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const url = new URL(trimmed)
      if (!/(?:^|\.)clickup\.com$/i.test(url.hostname)) {
        return null
      }
      const segments = url.pathname.split('/').filter(Boolean)
      const taskIndex = segments.indexOf('t')
      // Why: chat thread URLs (/v/cn/<channel>/t/<id>) carry a message id, not a task.
      if (taskIndex === -1 || segments.includes('cn') || segments.includes('chat')) {
        return null
      }
      const last = segments.at(-1)
      return last && taskIndex < segments.length - 1 ? referenceFromSegment(last) : null
    } catch {
      return null
    }
  }
  return referenceFromSegment(trimmed)
}

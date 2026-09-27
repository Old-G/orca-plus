// Custom build (claude-handoff-launch): reads the file `strata:handoff` writes before a Claude
// session stops, so Orca+ can offer a fresh session that starts from its saved prompt.

export type ClaudeHandoffFile = {
  session: string
  created: string
  branch: string | null
  head: string | null
  pushed: string | null
  prompt: string
}

/** What the renderer shows; the prompt itself stays on the execution host until launch. */
export type ClaudeHandoffOffer = {
  id: string
  worktreeId: string
  worktreeTitle: string
  sessionId: string
  created: string
  branch: string | null
  head: string | null
  pushed: string | null
}

export type ClaudeHandoffLaunchResult =
  | { ok: true; worktreeId: string }
  | { ok: false; error: string }

// Why: a launch prompt is typed into the agent; anything this large is not a handoff prompt.
const MAX_PROMPT_LENGTH = 20_000
const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/

/** Null for an id that could climb out of the handoff folder. */
export function claudeHandoffRelativePath(sessionId: string): string | null {
  return SESSION_ID_PATTERN.test(sessionId) ? `.claude/handoff/handoff-${sessionId}.md` : null
}

function readFrontmatter(lines: string[]): { fields: Map<string, string>; end: number } | null {
  if (lines[0]?.trim() !== '---') {
    return null
  }
  const fields = new Map<string, string>()
  for (let index = 1; index < lines.length; index += 1) {
    const line = lines[index]
    if (line.trim() === '---') {
      return { fields, end: index }
    }
    const match = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line)
    if (match) {
      fields.set(match[1], match[2].trim().replace(/^(['"])(.*)\1$/, '$2'))
    }
  }
  return null
}

function readPromptBlock(lines: string[], from: number): string | null {
  const heading = lines.findIndex((line, index) => index > from && /^##\s+Prompt\s*$/.test(line))
  if (heading === -1) {
    return null
  }
  for (let index = heading + 1; index < lines.length; index += 1) {
    const line = lines[index]
    if (/^##\s/.test(line)) {
      return null
    }
    const open = /^(`{3,})text\s*$/.exec(line)
    if (!open) {
      continue
    }
    const fence = open[1]
    const body: string[] = []
    for (let inner = index + 1; inner < lines.length; inner += 1) {
      if (lines[inner].trim().startsWith(fence) && /^`+$/.test(lines[inner].trim())) {
        return body.join('\n')
      }
      body.push(lines[inner])
    }
    return null
  }
  return null
}

export function parseClaudeHandoffFile(
  content: string,
  expectedSession: string
): ClaudeHandoffFile | null {
  const lines = content.replace(/\r\n/g, '\n').split('\n')
  const frontmatter = readFrontmatter(lines)
  if (!frontmatter) {
    return null
  }
  const { fields } = frontmatter
  const created = fields.get('created') ?? ''
  if (
    fields.get('type') !== 'strata-handoff' ||
    fields.get('session') !== expectedSession ||
    Number.isNaN(Date.parse(created))
  ) {
    return null
  }
  const prompt = readPromptBlock(lines, frontmatter.end)?.trim()
  if (!prompt || prompt.length > MAX_PROMPT_LENGTH) {
    return null
  }
  return {
    session: expectedSession,
    created,
    branch: fields.get('branch') || null,
    head: fields.get('head') || null,
    pushed: fields.get('pushed') || null,
    prompt
  }
}

// Custom build (slack-notifications): agent Markdown → Slack mrkdwn, and splitting it into blocks.

// Why: Slack caps a section block's text at 3000 characters.
export const SLACK_SECTION_TEXT_LIMIT = 2900

const FENCE = '```'

/** Slack only needs &, < and > escaped in plain text. */
export function escapeSlackText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function convertInline(text: string): string {
  // Why: inline code must keep its content verbatim, so it is cut out before any rewrite; the
  // private-use placeholders cannot occur in agent text.
  const codes: string[] = []
  let out = text.replace(/`[^`\n]+`/g, (code) => {
    codes.push(code)
    return `\uE000${codes.length - 1}\uE000`
  })
  out = escapeSlackText(out)
  const bold: string[] = []
  out = out
    .replace(/\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)/g, '<$2|$1>')
    .replace(/(\*\*|__)(?=\S)(.+?)(?<=\S)\1/g, (_match, _marker, inner: string) => {
      bold.push(inner)
      return `\uE001${bold.length - 1}\uE001`
    })
    .replace(/(^|[^\w*])\*(?=\S)([^*\n]+?)(?<=\S)\*(?!\w)/g, '$1_$2_')
    .replace(/~~(?=\S)(.+?)(?<=\S)~~/g, '~$1~')
  return out
    .replace(/\uE001(\d+)\uE001/g, (_match, index: string) => `*${bold[Number(index)]}*`)
    .replace(/\uE000(\d+)\uE000/g, (_match, index: string) => codes[Number(index)] ?? '')
}

function convertLine(line: string): string {
  const heading = /^#{1,6}\s+(.*)$/.exec(line)
  if (heading) {
    return `*${convertInline(heading[1]).replace(/\*/g, '')}*`
  }
  if (/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
    return '──────────'
  }
  const bullet = /^(\s*)[-*+]\s+(.*)$/.exec(line)
  if (bullet) {
    return `${bullet[1]}• ${convertInline(bullet[2])}`
  }
  return convertInline(line)
}

export function markdownToSlackMrkdwn(markdown: string): string {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n')
  let inFence = false
  return lines
    .map((line) => {
      if (line.trimStart().startsWith(FENCE)) {
        inFence = !inFence
        // Why: Slack ignores a fence's language tag and would print it as code.
        return FENCE
      }
      return inFence ? line : convertLine(line)
    })
    .join('\n')
    .trim()
}

/**
 * Splits mrkdwn into section-sized chunks on line boundaries, closing and reopening a code fence
 * that a cut lands inside so every block renders on its own.
 */
export function splitSlackMrkdwn(text: string, limit = SLACK_SECTION_TEXT_LIMIT): string[] {
  const chunks: string[] = []
  let current = ''
  let inFence = false
  const flush = (): void => {
    if (current.trim()) {
      chunks.push(inFence ? `${current}\n${FENCE}` : current)
    }
    current = inFence ? FENCE : ''
  }
  for (const rawLine of text.split('\n')) {
    // Why: one enormous line (minified output, a long URL) still has to fit a block.
    const pieces =
      rawLine.length > limit - 10 ? rawLine.match(new RegExp(`.{1,${limit - 10}}`, 'g')) : [rawLine]
    for (const line of pieces ?? ['']) {
      if (current.length + line.length + 1 > limit - FENCE.length - 1) {
        flush()
      }
      current = current ? `${current}\n${line}` : line
      if (line.trimStart().startsWith(FENCE)) {
        inFence = !inFence
      }
    }
  }
  if (current.trim() && current !== FENCE) {
    chunks.push(inFence ? `${current}\n${FENCE}` : current)
  }
  return chunks
}

/** Cuts a single-line preview without splitting a surrogate pair. */
export function previewText(value: string | undefined, max: number): string {
  const normalized = value?.replace(/\s+/g, ' ').trim() ?? ''
  if (normalized.length <= max) {
    return normalized
  }
  let cut = normalized.slice(0, max - 1)
  const last = cut.charCodeAt(cut.length - 1)
  if (last >= 0xd800 && last <= 0xdbff) {
    cut = cut.slice(0, -1)
  }
  return `${cut}…`
}

// Custom build (hq-plus-ui-v2): an agent's markdown as plain feed text — bold stays bold, `code` and
// versions become small chips, links keep their words, list marks become «·» — so no asterisks or
// backticks reach the owner's eye.

export type HqPlusSpan =
  | { kind: 'text'; text: string }
  | { kind: 'bold'; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'link'; text: string; href: string }

/** Custom build (hq-plus-map): a line that opens with «Done:», «Question:»… is told apart by its label. */
export type HqPlusLineLabel = 'done' | 'question' | 'next' | 'note'

export type HqPlusTextLine = {
  bullet: boolean
  spans: HqPlusSpan[]
  label?: { kind: HqPlusLineLabel; text: string }
}

const LABELS: Readonly<Record<string, HqPlusLineLabel>> = {
  done: 'done',
  result: 'done',
  question: 'question',
  asked: 'question',
  blocked: 'question',
  next: 'next',
  answer: 'note',
  note: 'note'
}
const LABEL = /^(Done|Result|Question|Asked|Blocked|Next|Answer|Note):\s*/i

/** The line's label cut off its first words, when it has one. */
function labelled(line: HqPlusTextLine): HqPlusTextLine {
  const first = line.spans[0]
  const match = first?.kind === 'text' ? LABEL.exec(first.text) : null
  const kind = match ? LABELS[match[1].toLowerCase()] : undefined
  if (!match || !kind || first?.kind !== 'text') {
    return line
  }
  const rest = first.text.slice(match[0].length)
  return {
    ...line,
    label: { kind, text: match[1] },
    spans: rest ? [{ kind: 'text', text: rest }, ...line.spans.slice(1)] : line.spans.slice(1)
  }
}

const INLINE =
  /\*\*([^*]+)\*\*|__([^_]+)__|`([^`]+)`|\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)|(https?:\/\/\S+)/g
const LIST_MARK = /^\s*(?:[-*\u2022\u00b7]|\d+[.)])\s+/
const HEADING = /^\s*#{1,6}\s+/
const QUOTE = /^\s*>\s?/

export function hqPlusSpans(text: string): HqPlusSpan[] {
  const spans: HqPlusSpan[] = []
  let last = 0
  for (const match of text.matchAll(INLINE)) {
    const at = match.index ?? 0
    if (at > last) {
      spans.push({ kind: 'text', text: text.slice(last, at) })
    }
    const [, bold, boldAlt, code, linkText, linkHref, bare] = match
    if (bold ?? boldAlt) {
      spans.push({ kind: 'bold', text: bold ?? boldAlt ?? '' })
    } else if (code) {
      spans.push({ kind: 'code', text: code })
    } else if (linkText && linkHref) {
      spans.push({ kind: 'link', text: linkText, href: linkHref })
    } else if (bare) {
      spans.push({ kind: 'link', text: bare.replace(/^https?:\/\//, '').slice(0, 48), href: bare })
    }
    last = at + match[0].length
  }
  if (last < text.length) {
    spans.push({ kind: 'text', text: text.slice(last) })
  }
  // Why: a lone `*` left from broken markdown is noise in a feed line.
  return spans.map((span) =>
    span.kind === 'text' ? { ...span, text: span.text.replace(/\*\*|__/g, '') } : span
  )
}

/** Non-empty lines, at most `maxLines`, the last one marked when more were cut. */
export function hqPlusTextLines(markdown: string, maxLines = Infinity): HqPlusTextLine[] {
  const lines = markdown
    .split('\n')
    .map((line) => line.replace(HEADING, '').replace(QUOTE, ''))
    .filter((line) => line.trim() !== '' && !/^\s*(?:-{3,}|\*{3,})\s*$/.test(line))
  const shown = lines.slice(0, maxLines).map((line) =>
    labelled({
      bullet: LIST_MARK.test(line),
      spans: hqPlusSpans(line.replace(LIST_MARK, '').trim())
    })
  )
  if (lines.length > shown.length && shown.length > 0) {
    shown.at(-1)?.spans.push({ kind: 'text', text: ' \u2026' })
  }
  return shown
}

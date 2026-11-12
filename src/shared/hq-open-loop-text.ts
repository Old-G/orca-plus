// Custom build (hq-open-loops): how the open-loop detector reads one message — a thanks or
// an ok that says nothing, a question, a request without a question mark — in Russian and English.
// Words, not a model: what a rule cannot tell goes to the evening check.

const URL = /<?https?:\/\/[^\s<>]+>?/g
const SLACK_MARKUP = /<[@!#][^>]*>/g
const SHORTCODE = /:[a-z0-9_+'-]+:/gi
const CODE = /```[\s\S]*?```|`[^`\n]*`/g
// Why lines: a forwarded Slack message rides as a «↪ who: text» line, a quote as «> text».
export const HQ_LOOP_QUOTED_LINE = /^\s*(?:>|&gt;|\u21aa)/
const WORD_SPLIT = /[^a-z0-9\u0430-\u044f]+/
// Why a word list, not a phrase list: «ок, понял, спасибо!» is as empty as each word of it.
const ACK_WORDS = new Set([
  // спасибо спс пасиб благодарю большое огромное
  '\u0441\u043f\u0430\u0441\u0438\u0431\u043e',
  '\u0441\u043f\u0441',
  '\u043f\u0430\u0441\u0438\u0431',
  '\u0431\u043b\u0430\u0433\u043e\u0434\u0430\u0440\u044e',
  '\u0431\u043e\u043b\u044c\u0448\u043e\u0435',
  '\u043e\u0433\u0440\u043e\u043c\u043d\u043e\u0435',
  // ок окей понял поняла поняли понятно принял приняла приняли ясно ага угу
  '\u043e\u043a',
  '\u043e\u043a\u0435\u0439',
  '\u043f\u043e\u043d\u044f\u043b',
  '\u043f\u043e\u043d\u044f\u043b\u0430',
  '\u043f\u043e\u043d\u044f\u043b\u0438',
  '\u043f\u043e\u043d\u044f\u0442\u043d\u043e',
  '\u043f\u0440\u0438\u043d\u044f\u043b',
  '\u043f\u0440\u0438\u043d\u044f\u043b\u0430',
  '\u043f\u0440\u0438\u043d\u044f\u043b\u0438',
  '\u044f\u0441\u043d\u043e',
  '\u0430\u0433\u0430',
  '\u0443\u0433\u0443',
  // супер отлично класс круто
  '\u0441\u0443\u043f\u0435\u0440',
  '\u043e\u0442\u043b\u0438\u0447\u043d\u043e',
  '\u043a\u043b\u0430\u0441\u0441',
  '\u043a\u0440\u0443\u0442\u043e',
  'thanks',
  'thank',
  'you',
  'thx',
  'ty',
  'ok',
  'okay',
  'okey',
  'got',
  'it',
  'noted',
  'cool',
  'great',
  'nice',
  'super',
  'much',
  'a',
  'lot',
  'so'
])

// Why stems: a request is a verb to the reader or a word that asks, in any of its usual forms.
const ASK_STEMS = [
  '\u043f\u043e\u0441\u043c\u043e\u0442\u0440(?:\u0438|\u0438\u0442\u0435)',
  '\u0433\u043b\u044f\u043d(?:\u044c|\u044c\u0442\u0435|\u0435\u0448\u044c|\u0435\u0442\u0435|\u0438)',
  '\u043f\u0440\u043e\u0432\u0435\u0440(?:\u044c|\u044c\u0442\u0435)',
  '\u043f\u043e\u0434\u0441\u043a\u0430\u0436(?:\u0438|\u0438\u0442\u0435)',
  '\u043f\u0440\u0438\u0448\u043b(?:\u0438|\u0438\u0442\u0435)',
  '\u0441\u043a\u0438\u043d(?:\u044c|\u044c\u0442\u0435)',
  '\u0434\u0430\u0439(?:\u0442\u0435)? \u0437\u043d\u0430\u0442\u044c',
  '\u043d\u0430\u043f\u0438\u0448(?:\u0438|\u0438\u0442\u0435)',
  '\u043e\u0442\u043f\u0438\u0448(?:\u0438|\u0438\u0441\u044c|\u0438\u0442\u0435)',
  '\u043e\u0442\u0432\u0435\u0442\u044c(?:\u0442\u0435)?',
  '\u043f\u0440\u043e\u0448\u0443',
  '\u043f\u0440\u043e\u0441\u044c\u0431\u0430',
  '\u043f\u043e\u0436\u0430\u043b\u0443\u0439\u0441\u0442\u0430',
  '\u043f\u043b\u0438\u0437',
  '\u043f\u043e\u043c\u043e\u0433(?:\u0438|\u0438\u0442\u0435)',
  '\u043d\u0443\u0436(?:\u0435\u043d|\u043d\u0430|\u043d\u043e|\u043d\u044b) (?:\u0442\u0432\u043e|\u0432\u0430\u0448|\u043e\u0442 \u0442\u0435\u0431\u044f|\u043e\u0442 \u0432\u0430\u0441)',
  '\u0436\u0434(?:\u0443|\u0435\u043c) (?:\u0442\u0432\u043e|\u0432\u0430\u0448|\u043e\u0442\u0432\u0435\u0442|\u043e\u0442 \u0442\u0435\u0431\u044f|\u043e\u0442 \u0432\u0430\u0441)',
  '\u043c\u043e\u0436(?:\u0435\u0448\u044c|\u0435\u0442\u0435)',
  '\u0441\u043c\u043e\u0436(?:\u0435\u0448\u044c|\u0435\u0442\u0435)',
  '\u043d\u0435 \u043c\u043e\u0433(?:\u043b\u0430|\u043b\u0438)? \u0431\u044b',
  '\u043f\u043e\u0434\u0442\u0432\u0435\u0440\u0434(?:\u0438|\u0438\u0442\u0435)',
  '\u0441\u043e\u0433\u043b\u0430\u0441(?:\u0443\u0439|\u0443\u0439\u0442\u0435)',
  '\u043e\u0434\u043e\u0431\u0440(?:\u0438|\u0438\u0442\u0435)',
  'please',
  'pls',
  'plz',
  'kindly',
  'could you',
  'can you',
  'would you',
  'let me know',
  'need your',
  'take a look'
]
const ASK = new RegExp(`(?:^|[^a-z\u0430-\u044f])(?:${ASK_STEMS.join('|')})(?![a-z\u0430-\u044f])`)

function withoutMentions(text: string, names: readonly string[]): string {
  let plain = text.replace(SLACK_MARKUP, ' ')
  for (const name of [...names].sort((a, b) => b.length - a.length)) {
    plain = plain.split(`@${name}`).join(' ')
  }
  return plain.replace(/@\S+/g, ' ')
}

/** True for a message of thanks or acknowledgement only; a link or any other word makes it a message. */
export function hqLoopAck(text: string, names: readonly string[] = []): boolean {
  // Why an empty text counts: it is a file or a voice note, which is a message.
  if (!text.trim() || /https?:\/\//.test(text)) {
    return false
  }
  const words = withoutMentions(text, names)
    .replace(SHORTCODE, ' ')
    .toLowerCase()
    .replace(/\u0451/g, '\u0435')
    .split(WORD_SPLIT)
    .filter(Boolean)
  return words.every((word) => ACK_WORDS.has(word))
}

/** Why: a long message is a report; what it asks of the reader is in its opening or closing lines. */
const LONG_MESSAGE = 600
const EDGE_LINES = 2
// Why: «о чем мы вообще тут?))», «где-то? )» are jokes, not questions waiting for an answer.
const PLAYFUL = /\?+\s?\)|(?:\u0445\u0430){2,}|(?:\u0430\u0445){2,}|(?:\u0445\u0435){2,}|haha|lol/i

// Why: a write-up with headings or bold labels is a document posted for the record, not a chat ask.
const DOCUMENT_LINE = /^\s*(?:#{1,3}\s|\*\*[^*]{1,60}\*\*\s*$|\*\*[^*]{1,40}:\*\*)/

function askIn(text: string, asks: (line: string) => boolean): 'own' | 'quoted' | null {
  if (text.split('\n').filter((line) => DOCUMENT_LINE.test(line)).length >= 2) {
    return null
  }
  const lines = text
    .replace(CODE, ' ')
    .replace(URL, ' ')
    .split('\n')
    .filter((line) => line.trim())
  const read =
    text.length > LONG_MESSAGE && lines.length > 2 * EDGE_LINES
      ? [...lines.slice(0, EDGE_LINES), ...lines.slice(-EDGE_LINES)]
      : lines
  let quoted = false
  for (const line of read) {
    if (!asks(line)) {
      continue
    }
    if (!HQ_LOOP_QUOTED_LINE.test(line)) {
      return 'own'
    }
    quoted = true
  }
  return quoted ? 'quoted' : null
}

// Why: «…почему?» or "why?" inside a message quotes someone else's question.
const INLINE_QUOTE = /\u00ab[^\u00bb\n]*\u00bb|"[^"\n]*"|\u201c[^\u201d\n]*\u201d/g
// Why: a sentence that opens with «если что — напиши» or "if anything breaks, let me know" asks
// nothing now; "can you check if…" still asks.
const CONDITIONAL =
  /(?:^|[.!?;:\u2026]\s+|\s[-\u2014]\s+)(?:\u0435\u0441\u043b\u0438|if)(?![a-z\u0430-\u044f])/
// Why: «вопрос снимаю», «отбой», "never mind" — the one who asked took it back.
const WITHDRAWN =
  /(?:^|[^a-z\u0430-\u044f])(?:\u0441\u043d\u0438\u043c\u0430\u044e|\u043e\u0442\u0431\u043e\u0439|\u043d\u0435\u0430\u043a\u0442\u0443\u0430\u043b\u044c\u043d|\u043d\u0435 \u0430\u043a\u0442\u0443\u0430\u043b\u044c\u043d|\u0443\u0436\u0435 \u043d\u0435 \u043d\u0443\u0436\u043d|\u0437\u0430\u0431\u0435\u0439|never ?mind|no longer needed)/

const fold = (line: string): string => line.toLowerCase().replace(/\u0451/g, '\u0435')

const asksByMark = (line: string): boolean => {
  const own = line.replace(INLINE_QUOTE, ' ')
  return own.includes('?') && !PLAYFUL.test(fold(own))
}

// Why: «встреча в 15.30, норм?», "can we start earlier today?" — a day later the moment is gone.
const TIME_BOUND =
  /(?:^|[^\d:.])(?:[01]?\d|2[0-3])[:.][0-5]\d(?![\d:.])|(?:^|[^a-z\u0430-\u044f])(?:\u0441\u0435\u0433\u043e\u0434\u043d\u044f|today|tonight|\u0440\u0430\u043d\u044c\u0448\u0435|earlier)(?![a-z\u0430-\u044f])/

/** True for an ask tied to a time of today: by the time it is overdue, it may be moot. */
export function hqLoopTimeBound(text: string): boolean {
  return TIME_BOUND.test(fold(text))
}

/** True when the message takes back an earlier ask of its author. */
export function hqLoopWithdrawn(text: string): boolean {
  return WITHDRAWN.test(fold(text))
}

/** Where a message holds a question: in its own words, only inside a quote or forward, or nowhere.
 *  A «?» in a link or in code, or in a joke, is no question; a long report asks only at its edges. */
export function hqLoopQuestion(text: string): 'own' | 'quoted' | null {
  return askIn(text, asksByMark)
}

/** Where a message asks something of the reader: a question, or a request without a question mark
 *  («посмотри, пожалуйста», «can you…»). A status, a report or thanks asks nothing. */
export function hqLoopAsk(text: string): 'own' | 'quoted' | null {
  return askIn(
    text,
    (line) => asksByMark(line) || (ASK.test(fold(line)) && !CONDITIONAL.test(fold(line)))
  )
}

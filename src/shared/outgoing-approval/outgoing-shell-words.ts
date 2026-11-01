// Custom build (remote-own-work, plan 15.17): reads shell text only as far as it can be sure of —
// the words of one command, which shell each place runs in, and variables set once. Null means unsure.

const BLANK = /[ \t]/
const QUOTE = /['"`]/
const ENDS_COMMAND = /[\n;&|)]/
// Why: `<<` starts a heredoc whose end this reader does not look for.
const REDIRECT = /^(?:&>>?|\d*(?:>>|>&|>\||<&|<>|>|<(?!<)))/

/** `redirect`: the file a `>`-style redirection writes, which the caller must also judge. */
export type Word = { text: string; quote: '' | '"' | "'"; at: number; redirect?: boolean }
export type Binding = { value: string | null; at: number; context: string }

/**
 * The redirection at `at`: the index after it and the file it writes (null for a read or a descriptor);
 * `next` -1 when there is none, -2 when it cannot be read for sure.
 */
function readRedirect(text: string, at: number): { next: number; writes: Word | null } {
  const op = REDIRECT.exec(text.slice(at))?.[0]
  if (!op) {
    return { next: /^\d*<</.test(text.slice(at)) ? -2 : -1, writes: null }
  }
  let i = at + op.length
  if (op.endsWith('&') && /[\d-]/.test(text[i] ?? '')) {
    return { next: i + 1, writes: null }
  }
  while (BLANK.test(text[i] ?? '')) {
    i++
  }
  const start = i
  while (i < text.length && !/[\s;&|)<>'"`]/.test(text[i])) {
    i++
  }
  const target = text.slice(start, i)
  // Why: `<(…)` or `>$(…)` runs a command the reader would mistake for the end of this one.
  if (!target || /[($`\\]/.test(target)) {
    return { next: -2, writes: null }
  }
  return {
    next: i,
    writes: /^\d*</.test(op) ? null : { text: target, quote: '', at: start, redirect: true }
  }
}

/** The quotes at `at` close an outer argument: nothing but redirections follows before the command ends. */
function endsHere(text: string, at: number): boolean {
  let i = at
  while (QUOTE.test(text[i] ?? '')) {
    i++
  }
  for (;;) {
    const gap = i
    while (BLANK.test(text[i] ?? '')) {
      i++
    }
    if (i >= text.length || (ENDS_COMMAND.test(text[i]) && !text.startsWith('&>', i))) {
      return true
    }
    if (text[i] === '#' && i > gap) {
      return true
    }
    const { next } = readRedirect(text, i)
    if (next < 0) {
      return false
    }
    i = next
  }
}

/** The words of the command whose arguments start at `from`, or null when they cannot be read for sure. */
export function readWords(text: string, from: number): Word[] | null {
  const words: Word[] = []
  let i = from
  for (;;) {
    const gap = i
    while (BLANK.test(text[i] ?? '')) {
      i++
    }
    const ch = text[i]
    if (ch === undefined || (ENDS_COMMAND.test(ch) && !text.startsWith('&>', i))) {
      return words
    }
    if (ch === '#' && i > gap) {
      return words
    }
    if (QUOTE.test(ch)) {
      if (endsHere(text, i)) {
        return words
      }
      const close = ch === '`' ? -1 : text.indexOf(ch, i + 1)
      const body = close === -1 ? '' : text.slice(i + 1, close)
      const after = text[close + 1] ?? ''
      const closesOuter = QUOTE.test(after) && endsHere(text, close + 1)
      if (
        close === -1 ||
        /[\\`\n]|\$\(/.test(body) ||
        !(after === '' || /[\s;&|)<>]/.test(after) || closesOuter)
      ) {
        return null
      }
      words.push({ text: body, quote: ch === '"' ? '"' : "'", at: i })
      if (closesOuter) {
        return words
      }
      i = close + 1
      continue
    }
    const redirect = readRedirect(text, i)
    if (redirect.next === -2) {
      return null
    }
    if (redirect.next !== -1) {
      if (redirect.writes) {
        words.push(redirect.writes)
      }
      i = redirect.next
      continue
    }
    const start = i
    while (i < text.length && !/[\s;&|)<>'"`]/.test(text[i])) {
      i++
    }
    if (i === start) {
      return null
    }
    words.push({ text: text.slice(start, i), quote: '', at: start })
    // Why: a quote stuck to a word ends an outer argument (`ssh h 'rm -f /tmp/x'`) or splices the word.
    if (QUOTE.test(text[i] ?? '')) {
      return endsHere(text, i) ? words : null
    }
  }
}

const HEREDOC = /^<<(-?)[ \t]*(['"]?)(\w+)\2/

function inComment(text: string, at: number): boolean {
  const line = text.slice(text.lastIndexOf('\n', at - 1) + 1, at)
  return /(?:^|\s)#/.test(line)
}

/**
 * Per index, the quotes and parentheses open there: two places share a shell only when theirs match.
 * A heredoc body is skipped (its quotes are not the shell's) and is a context of its own: it may be
 * another program's text, and `S=…` there sets nothing in this shell.
 */
export function contextKeys(text: string): string[] {
  const stack: string[] = []
  const keys: string[] = []
  const heredocs: { end: RegExp; key: string }[] = []
  for (let i = 0; i < text.length; i++) {
    keys[i] = stack.join(',')
    const ch = text[i]
    const top = stack.at(-1)
    const doc =
      ch === '<' &&
      text[i - 1] !== '<' &&
      !stack.some((open) => QUOTE.test(open[0])) &&
      !inComment(text, i)
        ? HEREDOC.exec(text.slice(i))
        : null
    if (ch === '\n' && heredocs.length > 0) {
      for (const { end, key } of heredocs.splice(0)) {
        end.lastIndex = i + 1
        const stop = end.exec(text)
        const last = stop ? stop.index + stop[0].length : text.length
        for (let k = i + 1; k < last; k++) {
          keys[k] = key
        }
        i = last - 1
      }
    } else if (doc) {
      const tabs = doc[1] === '-' ? '\\t*' : ''
      heredocs.push({
        end: new RegExp(`^${tabs}${doc[3]}$`, 'gm'),
        key: [keys[i], `${doc[2] ? "<'" : '<'}${i}`].filter(Boolean).join(',')
      })
      for (let k = i; k < i + doc[0].length; k++) {
        keys[k] = keys[i]
      }
      i += doc[0].length - 1
    } else if (ch === '\\') {
      keys[i + 1] = keys[i]
      i++
    } else if (QUOTE.test(ch)) {
      if (top?.[0] === ch) {
        stack.pop()
      } else {
        stack.push(`${ch}${i}`)
      }
    } else if (ch === '(') {
      stack.push(`(${i}`)
    } else if (ch === ')' && top?.[0] === '(') {
      stack.pop()
    }
  }
  return keys
}

const MKTEMP_VALUE = /^"?(?:\$\(mktemp\b[^()$`'";&|\n]*\)|`mktemp\b[^()$`'";&|\n]*`)"?/
const LITERAL_VALUE = /^(["']?)([^\s'"$`\\;&|()<>{}*?[\]~]+)\1/
// Why: the shell sets these itself, or they change how every later word is read.
const SHELL_OWNED =
  /^(?:_|PWD|OLDPWD|REPLY|IFS|HOME|PATH|CDPATH|ENV|BASH_ENV|SHELLOPTS|BASHOPTS|PS4|RANDOM|SECONDS|LINENO)$/
// Why: what runs before a literal setting must be plain commands, so the setting surely runs here.
const COMPOUND = /[{}()`]|<<|\b(?:if|then|else|elif|do|while|until|for|case|select|function)\b/

/**
 * Whether a shell outside this context expands `$X` first: a double quote, backquote or unquoted heredoc
 * met before a single quote or a quoted heredoc hands the text on as is.
 */
function expandsEarly(context: string): boolean {
  for (const open of context ? context.split(',') : []) {
    if (open.startsWith("'") || open.startsWith("<'")) {
      return false
    }
    if (open.startsWith('"') || open.startsWith('`') || open.startsWith('<')) {
      return true
    }
  }
  return false
}

/**
 * Variables set once, as a statement of their own: null value marks a `mktemp` result, set where no
 * outer shell expands it; a literal path counts only when set at the top level of this shell before
 * any compound command (`if`, a function, a subshell), where it surely runs. Rebound, piped,
 * command-prefix and shell-owned names are left out.
 */
export function bindingsIn(command: string, keys: string[]): Map<string, Binding> {
  const bindings = new Map<string, Binding>()
  const statement = /(?:^|[\n;'"(]|&&|\|\|)[ \t]*(?:export[ \t]+)?([A-Za-z_]\w*)=/g
  for (const match of command.matchAll(statement)) {
    const name = match[1]
    const valueAt = match.index + match[0].length
    const rest = command.slice(valueAt)
    const mktemp = MKTEMP_VALUE.exec(rest)?.[0]
    const literal = mktemp ? null : LITERAL_VALUE.exec(rest)
    const length = mktemp?.length ?? literal?.[0].length ?? 0
    const tail = /^[ \t]*(?:$|\n|;|&&)/.test(rest.slice(length))
    const nameAt = valueAt - name.length - 1
    const context = keys[nameAt]
    // Why: right after a quote or parenthesis only when it opens one (`ssh h 'D=…`), not closes one.
    const opener = /['"(]/.test(match[0][0]) ? `${match[0][0]}${match.index}` : null
    const startsStatement =
      !opener || context === [keys[match.index], opener].filter(Boolean).join(',')
    // Why: a skipped setting leaves the variable empty; only a whole-word mktemp use stays harmless then.
    const sure = mktemp
      ? !expandsEarly(context)
      : context === '' && !/^(?:&&|\|\|)/.test(match[0]) && !COMPOUND.test(command.slice(0, nameAt))
    if (
      length === 0 ||
      !tail ||
      !startsStatement ||
      !sure ||
      SHELL_OWNED.test(name) ||
      reboundElsewhere(command, name)
    ) {
      continue
    }
    bindings.set(name, { value: literal?.[2] ?? null, at: nameAt, context })
  }
  return bindings
}

function reboundElsewhere(command: string, name: string): boolean {
  const assignments = command.match(new RegExp(String.raw`(?<![\w$./-])${name}\+?=`, 'g')) ?? []
  return (
    assignments.length !== 1 ||
    new RegExp(
      String.raw`\b(?:for|read|unset|local|declare|typeset|readonly|getopts|mapfile|readarray|printf\s+-v)\b[^\n;|&]*?(?<![\w$])${name}\b`
    ).test(command) ||
    new RegExp(String.raw`\$\{${name}[^}\w]|(?<![\w$])${name}\[`).test(command)
  )
}

// Custom build (hq-plus-cards): what a person said, as a feed card shows it — without the Approve
// footer under the owner's own message, the author's name said twice, or Slack's «[file: …]» marks.

export type HqPlusSaid = {
  text: string
  /** Files the message carried, shown as one «N files ↗» beside the text. */
  files: number
}

// Why: Approve signs every sent message «_↳ DEV-… · project · «chat» · ref …_ *Sent using* <@U…>».
const APPROVE_FOOTER = /\n*_\u21b3 [^\n]*?_(?:\s*\*Sent using\*\s*<@[UW][A-Z0-9]+>)?\s*$/
const SENT_USING = /\s*\*Sent using\*\s*<@[UW][A-Z0-9]+>\s*$/
const FILE_MARK = /\[file: [^\]\n]+\]/g

export function hqPlusSaid(raw: string, author: string | null = null): HqPlusSaid {
  let text = raw.replace(APPROVE_FOOTER, '').replace(SENT_USING, '')
  const files = text.match(FILE_MARK)?.length ?? 0
  text = text
    .split('\n')
    .flatMap((line) => {
      if (!line.includes('[file: ')) {
        return [line]
      }
      const left = line.replace(FILE_MARK, '')
      // Why: a line left with only its speaker («Ann:») once its file mark is gone says nothing.
      return /^(?:[^\n:]{1,40}:)?\s*$/.test(left.trim()) ? [] : [left]
    })
    .join('\n')
  const name = author?.trim()
  // Why: a reply read from Slack starts with its speaker, and the card names the author already. A
  // thread that opens with someone else («Bob: …») keeps every name, so who said what stays clear.
  if (name && text.startsWith(`${name}:`)) {
    const prefix = `${name}:`
    text = text
      .split('\n')
      .map((line) => (line.startsWith(prefix) ? line.slice(prefix.length).trimStart() : line))
      .join('\n')
  }
  text = text
    // Why: a reply opens by tagging the owner, who reads it on his own card.
    .replace(/^\s*<@[UW][A-Z0-9]+>[\s,:]*/, '')
    // Why: Slack's *bold* is one star; the feed's text reads markdown's two.
    .replace(/(^|[\s(\u00ab"])\*([^*\n]+?)\*(?=$|[\s.,!?;:)\u00bb"])/gm, '$1**$2**')
    // Why: Slack's bullets come with a tab; the feed's list reads «• text».
    .replace(/^(\s*)\u2022\s+/gm, '$1\u2022 ')
    // Why: a Slack link reads «label (https://…)»; the label stays, the address becomes a small ↗.
    .replace(/ \((https?:\/\/[^\s)]+)\)/g, ' [\u2197]($1)')
  return { text: text.replace(/[ \t]+$/gm, '').trim(), files }
}

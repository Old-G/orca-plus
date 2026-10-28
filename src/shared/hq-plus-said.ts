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
    .replace(FILE_MARK, '')
    .split('\n')
    // Why: a line left with only its speaker («Ann:») once its file mark is gone says nothing.
    .filter((line) => !/^[^\n:]{1,40}:\s*$/.test(line.trim()))
    .join('\n')
  const name = author?.trim()
  if (name) {
    const prefix = `${name}:`
    // Why: a reply read from Slack starts with its speaker; the card names the author already.
    const speakers = text.split('\n').filter((line) => /^[^\s:][^:\n]{0,40}:\s/.test(line))
    if (text.startsWith(prefix) && speakers.every((line) => line.startsWith(prefix))) {
      text = text
        .split('\n')
        .map((line) => (line.startsWith(prefix) ? line.slice(prefix.length).trimStart() : line))
        .join('\n')
    }
  }
  text = text
    // Why: a reply opens by tagging the owner, who reads it on his own card.
    .replace(/^\s*<@[UW][A-Z0-9]+>[\s,:]*/, '')
    // Why: Slack's *bold* is one star; the feed's text reads markdown's two.
    .replace(/(^|[\s(\u00ab"])\*([^*\n]+?)\*(?=$|[\s.,!?;:)\u00bb"])/gm, '$1**$2**')
  return { text: text.replace(/[ \t]+$/gm, '').trim(), files }
}

// Custom build (hq-intake-thread, owner 03.11): «To work» on a Slack thread hands the chat the thread
// whole — the request in its root, the owner's own lines, a bot's reply with the task it opened — and
// every link said there. A card used to carry the person's last five lines and the newest reply's
// link; the chat got «I'm only glad)» and no ClickUp task.
import type { HqSlackLedgerMessage } from './hq-slack-ledger-reader'

export type HqIntakeThread = {
  /** «Name: text» per message, oldest first; the owner is «You», a bot «Bot». */
  lines: string[]
  /** Every link said in the thread, first seen first. */
  links: string[]
}

const MAX_LINES = 40
const LINE_MAX = 800
const URL = /https?:\/\/[^\s<>()"']+/g

export async function hqIntakeThreadOf(
  messages: readonly HqSlackLedgerMessage[],
  owner: string,
  name: (userId: string) => Promise<string>
): Promise<HqIntakeThread> {
  const lines: string[] = []
  const links = new Set<string>()
  for (const message of messages) {
    const said = message.text.replace(/\s+/g, ' ').trim()
    if (!said) {
      continue
    }
    for (const url of said.match(URL) ?? []) {
      links.add(url.replace(/[.,;:!?]+$/, ''))
    }
    const who =
      message.user === owner
        ? 'You'
        : message.bot || !message.user
          ? 'Bot'
          : await name(message.user).catch(() => 'Someone')
    lines.push(`${who}: ${said.length > LINE_MAX ? `${said.slice(0, LINE_MAX - 1)}…` : said}`)
  }
  // Why the root stays: it is the request; the middle of a long talk is what goes.
  const kept = lines.length > MAX_LINES ? [lines[0], '…', ...lines.slice(-(MAX_LINES - 1))] : lines
  return { lines: kept, links: [...links] }
}

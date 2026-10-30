// Custom build (hq-request-ledger): the Slack read the request ledger makes with the owner's token —
// one search over his DMs and the threads he takes part in.
import type { HqSlackLedgerMessage, HqSlackLedgerReadApi } from '../hq-today/hq-slack-ledger-reader'
import { plainSlackText } from '../hq-today/hq-slack-waiting-replies'
import { asSlackRecord, isSlackAuthError, SlackApiError, slackRequest } from './slack-request'

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null
}

const LEDGER_PAGE = 100
const LEDGER_PAGES = 5

/** `after:` takes a day; the day before `since` (local) keeps Slack's own time zone out of it. */
function searchDayBefore(since: number): string {
  const day = new Date(since - 24 * 60 * 60_000)
  return `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`
}

/** Custom build (hq-request-ledger): every message in the owner's DMs, in the threads he takes part
 *  in (`with:` himself) and that @mention him, his own included, newest first. */
export function createSlackLedgerApi(
  token: string,
  owner: string,
  name: (userId: string) => Promise<string>,
  isBot: (userId: string) => Promise<boolean>
): HqSlackLedgerReadApi {
  return {
    owner,
    name,
    withOwner: async (since) => {
      // Why both: `with:` holds DMs and threads, but a channel post that @mentions the owner (a
      // meeting's summary with his part) is in neither until someone answers in its thread.
      const found = new Map<string, HqSlackLedgerMessage>()
      for (const query of [`with:<@${owner}>`, `<@${owner}>`]) {
        let messages: HqSlackLedgerMessage[] = []
        try {
          messages = await search(query, since)
        } catch (error) {
          // Why: one query failing must not drop what the other read; a dead token fails both.
          if (
            isSlackAuthError(error) ||
            (error instanceof SlackApiError && error.code === 'missing_scope')
          ) {
            throw error
          }
          console.warn(`[hq-slack-ledger] search «${query}» failed:`, error)
        }
        for (const message of messages) {
          found.set(`${message.channel}:${message.ts}`, message)
        }
      }
      return [...found.values()].sort((a, b) => Number(b.ts) - Number(a.ts))
    }
  }

  async function search(query: string, since: number): Promise<HqSlackLedgerMessage[]> {
    const found: HqSlackLedgerMessage[] = []
    for (let page = 1; page <= LEDGER_PAGES; page += 1) {
      const body = await slackRequest(token, 'search.messages', {
        query: `${query} after:${searchDayBefore(since)}`,
        sort: 'timestamp',
        sort_dir: 'desc',
        count: LEDGER_PAGE,
        page
      })
      const messages = asSlackRecord(body.messages)
      const matches = Array.isArray(messages.matches) ? messages.matches : []
      let older = false
      for (const entry of matches) {
        const match = asSlackRecord(entry)
        const channel = asSlackRecord(match.channel)
        const id = asString(channel.id)
        const ts = asString(match.ts)
        if (!id || !ts) {
          continue
        }
        if (Number(ts) * 1000 < since) {
          older = true
          break
        }
        const user = asString(match.user)
        const raw = asString(match.text) ?? ''
        const permalink = asString(match.permalink)
        let threadTs: string | null = null
        try {
          threadTs = permalink ? new URL(permalink).searchParams.get('thread_ts') : null
        } catch {
          threadTs = null
        }
        found.push({
          channel: id,
          ts,
          threadTs,
          user,
          text: plainSlackText(raw),
          rawText: raw,
          permalink,
          dm: channel.is_im === true || channel.is_mpim === true || id.startsWith('D'),
          bot:
            Boolean(match.bot_id) ||
            match.subtype === 'bot_message' ||
            (user !== null && user !== owner && (await isBot(user)))
        })
      }
      const pages = Number(asSlackRecord(messages.paging).pages) || 1
      if (older || page >= pages) {
        break
      }
    }
    return found
  }
}

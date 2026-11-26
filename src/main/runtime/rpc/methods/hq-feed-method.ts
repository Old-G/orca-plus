// Custom build (hq-plus-ui): HQ+'s feed — the week's journal with the bell items it draws. Its own file
// since T8b (the methods file had outgrown its line budget).
import { defineMethod } from '../core'
import { HqFeedParams } from '../../../../shared/rpc-contract/hq-journal-params'
import { hqPlusFeedInbox, hqPlusFeedKeep } from '../../../../shared/hq-plus-feed-inbox'
import { HQ_JOURNAL_MAX_LIMIT } from '../../../../shared/hq-journal'
import { HQ_FEED_DEFAULT_LIMIT, HQ_PLUS_FEED_WINDOW_MS } from '../../../../shared/hq-plus-screen'
import { HQ_PLUS_CARD_KINDS, isHqPlusOwnerMessage } from '../../../../shared/hq-plus-log'

export const HQ_FEED_METHOD = defineMethod({
  name: 'hq.feed',

  permission: 'workspace',
  params: HqFeedParams,
  handler: async (params, { runtime }) => {
    const recent = runtime.pulseListJournal({
      since: params.since,
      limit: Math.min(params.limit ?? HQ_FEED_DEFAULT_LIMIT, HQ_JOURNAL_MAX_LIMIT)
    })
    // Why: what waits on the owner stays on his screen however old it is.
    const yours = runtime.pulseListJournal({
      needs: 'owner',
      status: 'open',
      limit: HQ_JOURNAL_MAX_LIMIT
    })
    // Why: a decision raised before the newest rows and settled since keeps its card in place.
    const decided = runtime.pulseListJournal({
      needs: 'owner',
      since: params.since,
      limit: HQ_JOURNAL_MAX_LIMIT
    })
    // Why: an older question the owner answered since is settled, yet its card stays in place.
    const seen = new Set(recent.map((entry) => entry.id))
    const answered = recent.flatMap((entry) => {
      const asked =
        isHqPlusOwnerMessage(entry) && entry.replyTo && !seen.has(entry.replyTo)
          ? runtime.pulseGetJournalEntry(entry.replyTo)
          : null
      return asked?.needs.startsWith('owner:') ? [asked] : []
    })
    const entries = [...recent]
    for (const entry of [...yours, ...decided, ...answered]) {
      if (!seen.has(entry.id)) {
        seen.add(entry.id)
        entries.push(entry)
      }
    }
    const addresses = [
      ...new Set(entries.flatMap((entry) => (entry.address ? [entry.address] : [])))
    ]
    const open = runtime.pulseListInbox(false).filter((item) => HQ_PLUS_CARD_KINDS.has(item.kind))
    const openIds = new Set(open.map((item) => item.id))
    // Custom build (t8b-feed-sql): the file returns only the settled rows the feed keeps.
    const settled = runtime
      .pulseListInbox(true, {
        ...(params.since === undefined ? {} : { since: params.since }),
        kinds: [...HQ_PLUS_CARD_KINDS],
        ...(params.settledSince === undefined
          ? {}
          : { keep: hqPlusFeedKeep(entries, params.settledSince) })
      })
      .filter((item) => HQ_PLUS_CARD_KINDS.has(item.kind) && !openIds.has(item.id))
    return {
      entries,
      sessions: addresses.flatMap((address) => runtime.pulseListSessionsByAddress(address)),
      inbox: hqPlusFeedInbox([...open, ...settled], entries, params.settledSince),
      now: Date.now(),
      // Custom build (hq-ledger-feed): what folds the feed's cards by conversation.
      ledger: runtime.pulseListLedgerFeed(params.since ?? Date.now() - HQ_PLUS_FEED_WINDOW_MS)
    }
  }
})

// Custom build (hq-feed): HQ's feed rows. A repeat of the same thing updates its row, so a Slack
// conversation that grows or a comment seen twice stays one line. No pulse event: nothing follows it.
import type { SqliteRow } from '../../sqlite/sqlite-statement'
import { HQ_FEED_SOURCES, type HqFeedItem, type HqFeedQuery } from '../../../shared/hq-feed'
import type { PulseCore } from './pulse-core'
import { integer, oneOf, optionalText, text } from './pulse-row-fields'

const DEFAULT_LIMIT = 200
const MAX_LIMIT = 500
const SEARCH_SCAN = 5000

function toItem(row: SqliteRow): HqFeedItem {
  return {
    id: text(row, 'id'),
    source: oneOf(row, 'source', HQ_FEED_SOURCES),
    kind: text(row, 'kind'),
    at: integer(row, 'at'),
    title: text(row, 'title'),
    body: optionalText(row, 'body'),
    url: optionalText(row, 'url'),
    project: optionalText(row, 'project'),
    person: optionalText(row, 'person')
  }
}

/** Adds new items and refreshes known ones; returns how many rows were new. */
export function upsertFeed(core: PulseCore, items: readonly HqFeedItem[]): number {
  if (items.length === 0) {
    return 0
  }
  return core.transaction(() => {
    const known = core.db.prepare('SELECT 1 AS found FROM feed WHERE id = ?')
    const write = core.db.prepare(
      `INSERT INTO feed (id, source, kind, at, title, body, url, project, person, seen_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET kind = excluded.kind, at = MAX(feed.at, excluded.at),
         title = excluded.title, body = excluded.body, url = COALESCE(excluded.url, feed.url),
         project = COALESCE(excluded.project, feed.project),
         person = COALESCE(excluded.person, feed.person)`
    )
    let added = 0
    for (const item of items) {
      if (!known.get(item.id)) {
        added += 1
      }
      write.run(
        item.id,
        item.source,
        item.kind,
        item.at,
        item.title,
        item.body,
        item.url,
        item.project,
        item.person,
        core.clock.now()
      )
    }
    return added
  })
}

/** Newest first. */
export function listFeed(core: PulseCore, query: HqFeedQuery = {}): HqFeedItem[] {
  const where: string[] = []
  const args: (string | number)[] = []
  if (query.before !== undefined) {
    where.push('at < ?')
    args.push(query.before)
  }
  if (query.source) {
    where.push('source = ?')
    args.push(query.source)
  }
  if (query.project) {
    where.push('project = ?')
    args.push(query.project)
  }
  const limit = Math.max(1, Math.min(query.limit ?? DEFAULT_LIMIT, MAX_LIMIT))
  const words = query.query?.trim().toLocaleLowerCase()
  const rows = core.db
    .prepare(
      `SELECT * FROM feed ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY at DESC LIMIT ?`
    )
    // Why: SQLite's lower() and LIKE fold only ASCII, so Russian words are matched here instead.
    .all(...args, words ? SEARCH_SCAN : limit)
    .map(toItem)
  return (
    words
      ? rows.filter((item) =>
          [item.title, item.body, item.person].join(' ').toLocaleLowerCase().includes(words)
        )
      : rows
  ).slice(0, limit)
}

/** Drops rows older than `beforeAt`; returns how many went. */
export function pruneFeed(core: PulseCore, beforeAt: number): number {
  return core.transaction(() =>
    Number(core.db.prepare('DELETE FROM feed WHERE at < ?').run(beforeAt).changes)
  )
}

// Custom build (hq-feed): fills HQ's feed from what Orca+ already gathers — the Slack scout's
// requests, conversations and quiet notes, the owner's ClickUp tasks' comments, the reviews waiting
// on him, what Approve let out, commits and finished agent sessions. No new reads of Slack or ClickUp.
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { HqFeedItem } from '../../shared/hq-feed'
import type { HqReview } from '../../shared/hq-project-pages'
import { HQ_SLACK_QUIET_FILE, parseHqSlackQuiet } from '../../shared/hq-slack-digest'
import {
  HQ_CLICKUP_OWN_FILE,
  HQ_CLICKUP_REQUESTS_FILE,
  HQ_SLACK_SCOUT_DIR,
  parseHqSlackScoutDrafts
} from '../../shared/hq-slack-scout'
import type { PulseDecision, PulseDraft, PulseInboxItem } from '../../shared/pulse-types'
import { BODY_MAX, TITLE_MAX, clip, time, webUrl } from './hq-feed-fields'
import { commitFeedItems, sentFeedItems, sessionFeedItems, type HqFeedCommit } from './hq-feed-work'

const DRAFTS_FILE = 'drafts.json'
const TOPICS_FILE = 'topics.json'
// Why: the scout writes every ten minutes and reviews are cached for two; the feed need not be faster.
const COLLECT_EVERY_MS = 5 * 60_000

export type HqFeedCollectorDeps = {
  hqPath: () => string | null
  decisions: () => PulseDecision[]
  /** Approve's drafts, so «sent» keeps only messages that went out. */
  drafts: () => PulseDraft[]
  /** Recent commits across the projects in Orca; absent = none. */
  commits?: () => Promise<HqFeedCommit[]>
  /** The bell's «An agent finished» items, read ones too. */
  finishedAgents?: () => PulseInboxItem[]
  reviews: () => Promise<HqReview[]>
  upsert: (items: HqFeedItem[]) => void
  now: () => number
}

async function readOptional(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8')
  } catch {
    return null
  }
}

function requests(text: string | null, now: number): HqFeedItem[] {
  if (!text) {
    return []
  }
  return parseHqSlackScoutDrafts(text).drafts.flatMap((draft): HqFeedItem[] => {
    const title = clip(draft.ask || draft.title, TITLE_MAX)
    return title
      ? [
          {
            id: `request:${draft.id}`,
            source: draft.source === 'clickup' ? 'clickup' : 'slack',
            kind: 'request',
            at: time(draft.foundAt, now),
            title,
            body: clip(draft.quote, BODY_MAX),
            url: webUrl(draft.permalink),
            project: clip(draft.project, 200),
            person: clip(draft.author, 200)
          }
        ]
      : []
  })
}

/** The scout's conversations: one row each, refreshed as the conversation grows. */
function topics(text: string | null, now: number): HqFeedItem[] {
  let raw: unknown
  try {
    raw = JSON.parse(text ?? '{}')
  } catch {
    return []
  }
  const all = raw && typeof raw === 'object' ? Reflect.get(raw, 'topics') : null
  const list: unknown[] = all && typeof all === 'object' ? Object.values(all) : []
  return list.flatMap((topic): HqFeedItem[] => {
    const field = (key: string): unknown =>
      topic && typeof topic === 'object' ? Reflect.get(topic, key) : undefined
    const id = clip(field('id'), 200)
    const subject = clip(field('subject'), TITLE_MAX)
    const people = field('people')
    return id && subject
      ? [
          {
            id: `slack:${id}`,
            source: 'slack',
            kind: 'conversation',
            at: time(field('lastAt'), now),
            title: subject,
            body: clip(field('summary'), BODY_MAX),
            url: null,
            project: null,
            person: Array.isArray(people)
              ? clip(people.filter((name) => typeof name === 'string').join(', '), 200)
              : null
          }
        ]
      : []
  })
}

function quiet(text: string | null): HqFeedItem[] {
  return parseHqSlackQuiet(text ?? '').map((item) => ({
    id: `slack-fyi:${item.id}`,
    source: 'slack',
    kind: 'fyi',
    at: time(item.at, 0),
    title: item.summary.slice(0, TITLE_MAX),
    body: item.why,
    url: item.permalink,
    project: null,
    person: item.author
  }))
}

function ownComments(text: string | null): HqFeedItem[] {
  let raw: unknown
  try {
    raw = JSON.parse(text ?? '{}')
  } catch {
    return []
  }
  const list = raw && typeof raw === 'object' ? Reflect.get(raw, 'comments') : null
  return (Array.isArray(list) ? list : []).flatMap((entry: unknown): HqFeedItem[] => {
    const field = (key: string): unknown =>
      entry && typeof entry === 'object' ? Reflect.get(entry, key) : undefined
    const link = webUrl(field('link'))
    const body = clip(field('text'), BODY_MAX)
    return link && body
      ? [
          {
            id: `clickup-own:${link}`,
            source: 'clickup',
            kind: 'my-comment',
            at: time(field('at'), 0),
            title: clip(field('task'), TITLE_MAX) ?? 'ClickUp',
            body,
            url: link,
            project: null,
            person: clip(field('to'), 200)
          }
        ]
      : []
  })
}

function reviews(list: readonly HqReview[], now: number): HqFeedItem[] {
  return list.map((review) => ({
    id: `git:${review.url}`,
    source: 'git',
    kind: 'review',
    at: review.updatedAt ?? now,
    title: `${review.ref} ${review.title}`.slice(0, TITLE_MAX),
    body: null,
    url: webUrl(review.url),
    project: review.ref.split(/[#!]/)[0] ?? null,
    person: review.author
  }))
}

/** One pass over every source; a source that fails is skipped, the rest still land. */
export async function collectHqFeed(deps: HqFeedCollectorDeps): Promise<number> {
  const hq = deps.hqPath()
  const now = deps.now()
  const dir = hq ? join(hq, HQ_SLACK_SCOUT_DIR) : null
  const read = (name: string): Promise<string | null> =>
    dir ? readOptional(join(dir, name)) : Promise.resolve(null)
  const [drafts, clickup, topicsText, quietText, own, waitingReviews, recentCommits] =
    await Promise.all([
      read(DRAFTS_FILE),
      read(HQ_CLICKUP_REQUESTS_FILE),
      read(TOPICS_FILE),
      read(HQ_SLACK_QUIET_FILE),
      read(HQ_CLICKUP_OWN_FILE),
      deps.reviews().catch(() => []),
      (deps.commits?.() ?? Promise.resolve([])).catch(() => [])
    ])
  const items = [
    ...requests(drafts, now),
    ...requests(clickup, now),
    ...topics(topicsText, now),
    ...quiet(quietText).filter((item) => item.at > 0),
    ...ownComments(own).filter((item) => item.at > 0),
    ...sentFeedItems(deps.decisions(), deps.drafts()),
    ...reviews(waitingReviews, now),
    ...commitFeedItems(recentCommits),
    ...sessionFeedItems(deps.finishedAgents?.() ?? [])
  ]
  deps.upsert(items)
  return items.length
}

export function startHqFeed(deps: HqFeedCollectorDeps): () => void {
  let running = false
  const collect = async (): Promise<void> => {
    if (running) {
      return
    }
    running = true
    try {
      await collectHqFeed(deps)
    } catch (error) {
      console.warn('[hq-feed] collect failed:', error instanceof Error ? error.message : error)
    } finally {
      running = false
    }
  }
  void collect()
  const timer = setInterval(() => void collect(), COLLECT_EVERY_MS)
  timer.unref?.()
  return () => clearInterval(timer)
}

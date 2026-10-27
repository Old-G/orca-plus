// Custom build (hq-slack-requests): keeps one bell item per Slack request the owner has not decided,
// read from the scout's files every minute and right after HQ records a decision.
import type { HqProjectPage } from '../../shared/hq-project-pages'
import {
  HQ_SLACK_REQUEST_BELL_KIND,
  hqProjectShortName,
  slackRequestBellItem
} from '../../shared/hq-slack-request-bell'
import type { HqSlackScoutResult } from '../../shared/hq-slack-scout'
import type { PulseBellInput } from '../../shared/pulse-bell'

// Why: the scout runs every 10 minutes; a minute is quick enough and costs three small file reads.
const REFRESH_MS = 60_000

export type HqSlackRequestBellDeps = {
  hqPath: () => string | null
  /** The «New view» switch; off closes every item. */
  enabled: () => boolean
  readScout: (hqPath: string) => Promise<HqSlackScoutResult>
  listPages: (hqPath: string) => Promise<HqProjectPage[]>
  sync: (kind: string, items: readonly PulseBellInput[]) => void
  onChanged: (listener: () => void) => () => void
  /** Custom build (hq-one-card): `channel:ts` of Slack messages another card already shows. */
  covered?: () => ReadonlySet<string>
}

export async function hqSlackRequestBellItems(
  deps: Pick<HqSlackRequestBellDeps, 'hqPath' | 'enabled' | 'readScout' | 'listPages' | 'covered'>
): Promise<PulseBellInput[] | null> {
  const hq = deps.hqPath()
  if (!hq || !deps.enabled()) {
    return []
  }
  const scout = await deps.readScout(hq)
  if (!scout.ok) {
    return null
  }
  const covered = deps.covered?.() ?? new Set<string>()
  const drafts = scout.drafts.filter((draft) => !covered.has(draft.id))
  const pages = drafts.some((draft) => draft.project)
    ? await deps.listPages(hq).catch(() => [])
    : []
  const names = new Map(pages.map((page) => [page.slug, hqProjectShortName(page)]))
  return drafts.map((draft) =>
    slackRequestBellItem(draft, draft.project ? (names.get(draft.project) ?? draft.project) : null)
  )
}

export function startHqSlackRequestBell(deps: HqSlackRequestBellDeps): () => void {
  let running = false
  let again = false
  const refresh = async (): Promise<void> => {
    if (running) {
      again = true
      return
    }
    running = true
    try {
      do {
        again = false
        // Why: a failed read keeps the items as they are rather than closing them all.
        const items = await hqSlackRequestBellItems(deps).catch(() => null)
        if (items) {
          deps.sync(HQ_SLACK_REQUEST_BELL_KIND, items)
        }
      } while (again)
    } finally {
      running = false
    }
  }
  void refresh()
  const timer = setInterval(() => void refresh(), REFRESH_MS)
  const off = deps.onChanged(() => void refresh())
  return () => {
    clearInterval(timer)
    off()
  }
}

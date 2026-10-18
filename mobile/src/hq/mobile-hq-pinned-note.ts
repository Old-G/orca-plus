// Custom build (hq-pinned-counts): the count beside each of the phone's pinned HQ pages, as the
// desktop shows it.
import { hqCountText, type HqPinnedCounts } from '../../../src/shared/hq-pinned-counts'

export type MobileHqPageId = 'today' | 'notes' | 'done' | 'feed' | 'reports' | 'inbox'

/** The count beside a page; `needs` is what waits for the owner, the rest is merely new. */
export function mobileHqPinnedNote(
  counts: HqPinnedCounts | null,
  page: MobileHqPageId
): { text: string; needs: boolean } | null {
  if (!counts) {
    return null
  }
  const notes: Partial<Record<MobileHqPageId, { text: string; needs: boolean } | null>> = {
    today:
      counts.today > 0 ? { text: `${hqCountText(counts.today)} to decide`, needs: true } : null,
    notes:
      counts.onYou > 0 || counts.remind > 0
        ? {
            text: [
              counts.onYou > 0 ? `${counts.onYou} on you` : null,
              counts.remind > 0 ? `${counts.remind} to remind` : null
            ]
              .filter(Boolean)
              .join(' · '),
            needs: true
          }
        : null,
    reports:
      counts.reports > 0 ? { text: `${hqCountText(counts.reports)} new`, needs: true } : null,
    feed: counts.feed > 0 ? { text: `${hqCountText(counts.feed)} new`, needs: false } : null,
    done: counts.journal > 0 ? { text: `${hqCountText(counts.journal)} new`, needs: false } : null
  }
  return notes[page] ?? null
}

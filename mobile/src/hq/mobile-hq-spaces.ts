// Custom build (hq-spaces): the workspace the phone's HQ shows, and what each page keeps for it —
// the same rules as the desktop's HQ (a record no workspace claims shows in every one).
import {
  hqSpaceShows,
  hqSpaceUsesSource,
  type HqSpace,
  type HqSpaceRef
} from '../../../src/shared/hq-spaces'

export type MobileHqSpaceFilter = { spaces: readonly HqSpace[]; active: string | null }

export const ALL_HQ_SPACES: MobileHqSpaceFilter = { spaces: [], active: null }

export function mobileHqShows(filter: MobileHqSpaceFilter, ref: HqSpaceRef): boolean {
  return hqSpaceShows(filter.spaces, filter.active, ref)
}

/** A Slack or ClickUp record with no project, placed by the workspace's messenger and tasks. */
export function mobileHqShowsSourced(
  filter: MobileHqSpaceFilter,
  project: string | null | undefined,
  source: string
): boolean {
  return project
    ? hqSpaceShows(filter.spaces, filter.active, { project })
    : hqSpaceUsesSource(filter.spaces, filter.active, source)
}

/** A report under `workspaces/<slug>/` only in its workspace; the global HQ's in every one. */
export function mobileHqShowsReport(filter: MobileHqSpaceFilter, space?: string): boolean {
  return !space || !filter.active || space === filter.active
}

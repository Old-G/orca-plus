// Custom build (hq-plus-ui): HQ events land in HQ+'s feed instead of popping up on the right, unless
// the owner switched that off in Settings → Workspace. Without an HQ folder there is no feed to land in.
import { useAppStore } from '@/store'
import type { GlobalSettings } from '../../../../../shared/global-settings-types'

export function hqPopupsGoToFeed(settings: GlobalSettings | null | undefined): boolean {
  return Boolean(settings?.hqPath) && settings?.hqPlusFeedInsteadOfPopups !== false
}

export function useHqPopupsGoToFeed(): boolean {
  return useAppStore((state) => hqPopupsGoToFeed(state.settings))
}

/** For code outside React: the same answer from the store as it is now. */
export function hqPopupsGoToFeedNow(): boolean {
  return hqPopupsGoToFeed(useAppStore.getState().settings)
}

// Custom build (hq-plus-ui): HQ events land in HQ+'s feed instead of popping up on the right, unless
// the owner switched that off in Settings → Workspace. Without an HQ folder there is no feed to land in.
// Only while HQ+ is the owner's HQ: the classic HQ keeps its popups exactly as they were.
import { useAppStore } from '@/store'
import type { GlobalSettings } from '../../../../../shared/global-settings-types'
import { useHqFlavor, type HqFlavor } from './hq-plus-flavor'

export function hqPopupsGoToFeed(
  settings: GlobalSettings | null | undefined,
  flavor: HqFlavor
): boolean {
  return (
    flavor === 'plus' && Boolean(settings?.hqPath) && settings?.hqPlusFeedInsteadOfPopups !== false
  )
}

export function useHqPopupsGoToFeed(): boolean {
  const flavor = useHqFlavor()
  return useAppStore((state) => hqPopupsGoToFeed(state.settings, flavor))
}

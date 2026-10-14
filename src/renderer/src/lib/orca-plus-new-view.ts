// Custom build (hq-chats): Orca+'s «New view» switch — HQ as a messenger, project colors, the reworked
// sidebar and the HQ/Code modes; off keeps every one of those surfaces as it was before.
import { useAppStore } from '@/store'

export function useOrcaPlusNewView(): boolean {
  return useAppStore((state) => state.settings?.hqChatsView !== false)
}

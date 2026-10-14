// Custom build (hq): Orca+'s HQ — the messenger view (agent chats beside pinned pages) or, behind
// its «New view» switch, the earlier tabs; another surface can open it on a given page.
import { useOrcaPlusNewView } from '@/lib/orca-plus-new-view'
import { useHqWebSettings } from './use-hq-web-settings'
import { HqClassicScreen } from './HqClassicScreen'
import { HqMessengerScreen } from './HqMessengerScreen'

export default function HqScreen(): React.JSX.Element {
  useHqWebSettings()
  return useOrcaPlusNewView() ? <HqMessengerScreen /> : <HqClassicScreen />
}

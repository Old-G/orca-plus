// Custom build (hq): Orca+'s HQ — agent chats beside the pinned pages; another surface can open it
// on a given page. Custom build (hq-plus-ui): or HQ+, the feed of threads, when the owner picked it.
import { useHqWebSettings } from './use-hq-web-settings'
import { HqMessengerScreen } from './HqMessengerScreen'
import { HqPlusScreen } from '../hq-plus/HqPlusScreen'
import { useHqFlavor } from '../hq-plus/hq-plus-flavor'

export default function HqScreen(): React.JSX.Element {
  useHqWebSettings()
  return useHqFlavor() === 'plus' ? <HqPlusScreen /> : <HqMessengerScreen />
}

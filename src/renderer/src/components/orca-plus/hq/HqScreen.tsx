// Custom build (hq): Orca+'s HQ — agent chats beside the pinned pages; another surface can open it
// on a given page.
import { useHqWebSettings } from './use-hq-web-settings'
import { HqMessengerScreen } from './HqMessengerScreen'

export default function HqScreen(): React.JSX.Element {
  useHqWebSettings()
  return <HqMessengerScreen />
}

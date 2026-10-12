import { FileDiff } from 'lucide-react'
import { translate } from '@/i18n/i18n'
import { openChatEditDiff, resolveChatEditDiffTarget } from './native-chat-edit-diff'

/** Custom build (chat-edit-diff): opens the edited file's diff in an editor tab. */
export function NativeChatOpenDiffButton({ path }: { path: string }): React.JSX.Element | null {
  const target = resolveChatEditDiffTarget(path)
  if (!target) {
    return null
  }
  const label = translate('components.native-chat.tool.openDiff', 'Open diff in editor')
  return (
    <button
      type="button"
      onClick={() => openChatEditDiff(target)}
      aria-label={label}
      title={label}
      className="flex size-6 shrink-0 items-center justify-center rounded-md text-chat-foreground-faint transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <FileDiff className="size-3.5" />
    </button>
  )
}

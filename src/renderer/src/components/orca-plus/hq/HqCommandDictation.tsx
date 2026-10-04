// Custom build (hq): the microphone beside HQ's command line — Orca's own dictation, started the way
// the chat composer starts it, so the words land in the focused command box.
import type { RefObject } from 'react'
import { Mic, Square } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import { isWebClientLocation } from '@/lib/web-client-location'
import { useNativeChatDictation } from '../../native-chat/use-native-chat-dictation'

export function HqCommandDictation(props: {
  textareaRef: RefObject<HTMLTextAreaElement | null>
  disabled: boolean
}): React.JSX.Element | null {
  // Why: dictation records on the desktop; the paired web client has no speech bridge yet.
  return isWebClientLocation() ? null : <CommandDictationButton {...props} />
}

function CommandDictationButton({
  textareaRef,
  disabled
}: {
  textareaRef: RefObject<HTMLTextAreaElement | null>
  disabled: boolean
}): React.JSX.Element {
  const {
    dictationDisabled: unavailable,
    isDictating: dictating,
    isDictationHoldMode: holdMode,
    toggleDictation,
    startHoldDictation,
    stopHoldDictation
  } = useNativeChatDictation(textareaRef)
  const off = disabled || unavailable
  const label = unavailable
    ? translate('auto.hq.today.dictationOff', 'Turn on voice dictation in Settings → Voice')
    : dictating
      ? translate('auto.hq.today.stopDictation', 'Stop dictation')
      : translate('auto.hq.today.startDictation', 'Dictate the command')
  const endHold = (): void => {
    if (holdMode && !off) {
      stopHoldDictation()
    }
  }
  return (
    <Button
      type="button"
      variant={dictating ? 'secondary' : 'ghost'}
      size="icon"
      aria-label={label}
      title={label}
      disabled={off}
      onClick={holdMode ? undefined : toggleDictation}
      onPointerDown={(event) => {
        if (holdMode && !off) {
          // Why: keeps focus in the command box, which is where the dictated words are inserted.
          event.preventDefault()
          startHoldDictation()
        }
      }}
      onPointerUp={endHold}
      onPointerCancel={endHold}
      onPointerLeave={(event) => {
        if (event.buttons === 1) {
          endHold()
        }
      }}
    >
      {dictating ? <Square className="size-3.5 fill-current" /> : <Mic className="size-4" />}
    </Button>
  )
}

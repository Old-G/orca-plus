// Custom build (hq-ask): the «Ask HQ» command line on Today — typed or dictated, it goes to HQ's
// standing «Ask HQ» chat.
import { useId, useLayoutEffect, useRef, useState } from 'react'
import { Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { translate } from '@/i18n/i18n'
import { HqCommandDictation } from './HqCommandDictation'
import { askHq, startHqAskSession } from './hq-ask-chat'

/** Why: the box grows with the text up to about ten lines, then scrolls. */
const MAX_HEIGHT_PX = 240

export function HqCommandBox({
  hqWorktreeId,
  compact = false,
  newChatEach = false
}: {
  hqWorktreeId: string | null
  /** Custom build (hq-today-inbox): a short hint for Today's narrow list column. */
  compact?: boolean
  /** Custom build (hq-plus-ask-new-chat, owner 12.11): HQ+ — every send opens a new HQ chat and the
   *  box grows as he writes; classic HQ keeps its one «Ask HQ» chat. */
  newChatEach?: boolean
}): React.JSX.Element {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const inputId = useId()
  // Why: dictation inserts words without React's onChange, so the height follows the input event too.
  useLayoutEffect(() => {
    const box = textareaRef.current
    if (!newChatEach || !box) {
      return
    }
    const fit = (): void => {
      box.style.height = 'auto'
      box.style.height = `${Math.min(box.scrollHeight, MAX_HEIGHT_PX)}px`
      box.style.overflowY = box.scrollHeight > MAX_HEIGHT_PX ? 'auto' : 'hidden'
    }
    fit()
    box.addEventListener('input', fit)
    return () => box.removeEventListener('input', fit)
  }, [newChatEach, text])
  // Custom build (hq-ask): every question goes to the one standing «Ask HQ» chat.
  const submit = (): void => {
    const question = text
    if (!hqWorktreeId || !question.trim() || busy) {
      return
    }
    setBusy(true)
    setText('')
    setError(null)
    void (newChatEach ? startHqAskSession : askHq)(hqWorktreeId, question)
      .then((result) => {
        if (!result.ok) {
          setText(question)
          setError(result.message)
        }
      })
      .finally(() => setBusy(false))
  }
  return (
    <form
      className="flex flex-col gap-1.5"
      onSubmit={(event) => {
        event.preventDefault()
        submit()
      }}
    >
      <div className="flex items-end gap-2">
        {/* Why: without a visible name the box read as an empty bar and the owner could not find it. */}
        <span className="flex h-9 shrink-0 items-center gap-1.5">
          <Sparkles className="size-4 text-primary" />
          <Label htmlFor={inputId}>{translate('auto.hq.today.ask', 'Ask HQ')}</Label>
        </span>
        <Textarea
          id={inputId}
          ref={textareaRef}
          className="min-h-9 flex-1 resize-none"
          rows={1}
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault()
              submit()
            }
          }}
          placeholder={
            compact
              ? translate('auto.hq.today.askShort', 'Ask HQ anything…')
              : translate(
                  'auto.hq.today.askPlaceholder',
                  'What did we decide about…, what did I write to…, a task — or a command'
                )
          }
          disabled={!hqWorktreeId}
        />
        <HqCommandDictation textareaRef={textareaRef} disabled={!hqWorktreeId} />
        <Button type="submit" disabled={!hqWorktreeId || !text.trim() || busy}>
          {translate('auto.hq.today.askButton', 'Ask')}
        </Button>
      </div>
      {hqWorktreeId ? null : (
        <p className="text-xs text-muted-foreground">
          {translate(
            'auto.hq.today.addHqProject',
            'Add the HQ folder as a project in Orca to run reminders and commands.'
          )}
        </p>
      )}
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </form>
  )
}

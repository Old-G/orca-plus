// Custom build (hq-clickup-requests): «Just reply» on a ClickUp comment — HQ drafts the owner's answer,
// he edits it here, and Send posts it as his comment. The click is the approval; nothing goes out alone.
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { translate } from '@/i18n/i18n'
import { HqCommandDictation } from '../hq/HqCommandDictation'

type Phase = 'drafting' | 'ready' | 'sending'

const failed = (error: unknown): { ok: false; error: string } => ({
  ok: false,
  error: String(error)
})

export function HqClickUpReplyComposer({
  id,
  onSent,
  onCancel
}: {
  id: string
  onSent: () => void
  onCancel: () => void
}): React.JSX.Element {
  const [phase, setPhase] = useState<Phase>('drafting')
  const [draft, setDraft] = useState<string | null>(null)
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    let live = true
    setPhase('drafting')
    setError(null)
    void window.api.hqProjects
      .draftClickUpReply({ id })
      .catch(failed)
      .then((result) => {
        if (!live) {
          return
        }
        if (result.ok) {
          setDraft(result.text)
          setText(result.text)
        } else {
          // Why: a failed draft still leaves the owner a box to write the answer himself.
          setError(result.error)
        }
        setPhase('ready')
        textareaRef.current?.focus()
      })
    return () => {
      live = false
    }
  }, [id])

  const send = async (): Promise<void> => {
    setPhase('sending')
    setError(null)
    const result = await window.api.hqProjects
      .sendClickUpReply({ id, text: text.trim(), ...(draft ? { draft } : {}) })
      .catch(failed)
    if (result.ok) {
      toast.success(translate('auto.hq.clickup.replySent', 'Reply posted in ClickUp.'))
      onSent()
      return
    }
    setPhase('ready')
    setError(result.error)
  }

  const busy = phase !== 'ready'
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-start gap-2">
        <Textarea
          ref={textareaRef}
          className="min-h-24 flex-1"
          value={text}
          disabled={busy}
          placeholder={
            phase === 'drafting'
              ? translate('auto.hq.clickup.drafting', 'Drafting the reply…')
              : translate('auto.hq.clickup.replyPlaceholder', 'Your reply')
          }
          onChange={(event) => setText(event.target.value)}
          aria-label={translate('auto.hq.clickup.replyLabel', 'Reply in ClickUp')}
        />
        <HqCommandDictation textareaRef={textareaRef} disabled={busy} />
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <Button type="button" size="xs" disabled={busy || !text.trim()} onClick={() => void send()}>
          {phase === 'sending'
            ? translate('auto.hq.clickup.sending', 'Sending…')
            : translate('auto.hq.clickup.send', 'Send')}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="xs"
          disabled={phase === 'sending'}
          onClick={onCancel}
        >
          {translate('auto.hq.project.cancel', 'Cancel')}
        </Button>
      </div>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  )
}

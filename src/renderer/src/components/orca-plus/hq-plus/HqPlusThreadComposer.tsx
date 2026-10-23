// Custom build (hq-plus-ui): with one thread on view, the bottom field writes into that thread's chat
// (its address, else its session), as the prototype does; with the whole log on view it is Ask HQ.
import { useId, useRef, useState } from 'react'
import { translate } from '@/i18n/i18n'
import type { HqPlusCard } from '../../../../../shared/hq-plus-log'
import { HqCommandDictation } from '../hq/HqCommandDictation'
import { replyOnHqPlusCard, sendIntoHqPlusChat, type HqPlusChatTarget } from './hq-plus-actions'

export function HqPlusThreadComposer({
  target,
  openQuestion,
  label,
  hqPath,
  onSent
}: {
  target: HqPlusChatTarget
  /** The thread's question still open: the words answer it, so its card folds with them. */
  openQuestion: HqPlusCard | null
  label: string
  hqPath: string | null
  onSent: () => void
}): React.JSX.Element {
  const inputId = useId()
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [text, setText] = useState('')
  // Custom build (hq-plus-ui-v3): what just went out, until the chat answers and the card moves on.
  const [sent, setSent] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const send = (): void => {
    if (busy || !text.trim()) {
      return
    }
    setBusy(true)
    setError(null)
    void (
      openQuestion
        ? replyOnHqPlusCard(openQuestion, text, hqPath)
        : sendIntoHqPlusChat(target, text, hqPath)
    )
      .then((result) => {
        if (result.ok) {
          setSent(text.trim())
          setText('')
          onSent()
        } else {
          setError(result.message)
        }
      })
      .finally(() => setBusy(false))
  }
  return (
    <div>
      <form
        className="hqp-reply hqp-thread-input"
        onSubmit={(event) => {
          event.preventDefault()
          send()
        }}
      >
        <label className="hqp-sr" htmlFor={inputId}>
          {translate('auto.hqPlus.threadInput', 'Write to this thread')}
        </label>
        <textarea
          id={inputId}
          ref={textareaRef}
          rows={1}
          value={text}
          disabled={busy}
          placeholder={translate('auto.hqPlus.threadInputHint', 'Write to {{thread}}…', {
            thread: label
          })}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            // Enter sends, Shift+Enter breaks the line; a composing IME keeps its Enter.
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault()
              send()
            }
          }}
        />
        <HqCommandDictation textareaRef={textareaRef} disabled={busy} />
        <span className="hqp-to">→ {target.address ?? label}</span>
        <button
          type="submit"
          className="hqp-go"
          disabled={busy || !text.trim()}
          aria-label={translate('auto.hqPlus.send', 'Send')}
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.6"
            aria-hidden="true"
          >
            <path d="M5 12h14M13 6l6 6-6 6" />
          </svg>
        </button>
      </form>
      {error ? <p className="hqp-error">{error}</p> : null}
      {sent && !error ? (
        <p className="hqp-sent">
          {translate('auto.hqPlus.sent', 'Sent')}: {sent}
        </p>
      ) : null}
    </div>
  )
}

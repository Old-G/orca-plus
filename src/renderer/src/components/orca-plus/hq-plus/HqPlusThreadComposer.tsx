// Custom build (hq-plus-ui): with one thread on view, the bottom field writes into that thread's chat
// (its address, else its session), as the prototype does; with the whole log on view it is Ask HQ.
import { useState } from 'react'
import { translate } from '@/i18n/i18n'
import type { HqPlusCard } from '../../../../../shared/hq-plus-log'
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
  const [text, setText] = useState('')
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
        <label className="hqp-sr" htmlFor="hqp-thread-input">
          {translate('auto.hqPlus.threadInput', 'Write to this thread')}
        </label>
        <input
          id="hqp-thread-input"
          value={text}
          disabled={busy}
          placeholder={translate('auto.hqPlus.threadInputHint', 'Write to {{thread}}…', {
            thread: label
          })}
          onChange={(event) => setText(event.target.value)}
        />
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
    </div>
  )
}

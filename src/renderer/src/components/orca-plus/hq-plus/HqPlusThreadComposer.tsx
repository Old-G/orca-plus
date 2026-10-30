// Custom build (hq-plus-ui): with one thread on view, the bottom field writes into that thread's chat
// (its address, else its session), as the prototype does; with the whole log on view it is Ask HQ.
import { useId, useState } from 'react'
import { translate } from '@/i18n/i18n'
import type { HqPlusCard } from '../../../../../shared/hq-plus-log'
import { HqPlusComposer } from './HqPlusComposer'
import { replyOnHqPlusCard, sendIntoHqPlusChat, type HqPlusChatTarget } from './hq-plus-actions'

export function HqPlusThreadComposer({
  target,
  openQuestion,
  label,
  hqPath,
  showTo = true,
  onSent
}: {
  target: HqPlusChatTarget
  /** Custom build (hq-plus-map): false where the card already names the chat right under the box. */
  showTo?: boolean
  /** The thread's question still open: the words answer it, so its card folds with them. */
  openQuestion: HqPlusCard | null
  label: string
  hqPath: string | null
  onSent: () => void
}): React.JSX.Element {
  const inputId = useId()
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
      <HqPlusComposer
        id={inputId}
        label={translate('auto.hqPlus.threadInput', 'Write to this thread')}
        value={text}
        busy={busy}
        placeholder={translate('auto.hqPlus.threadInputHint', 'Write to {{thread}}…', {
          thread: label
        })}
        to={showTo ? (target.address ?? label) : null}
        sendLabel={translate('auto.hqPlus.send', 'Send')}
        className="hqp-thread-input"
        onChange={setText}
        onSubmit={send}
      />
      {error ? <p className="hqp-error">{error}</p> : null}
      {sent && !error ? (
        <p className="hqp-sent">
          {translate('auto.hqPlus.sent', 'Sent')}: {sent}
        </p>
      ) : null}
    </div>
  )
}

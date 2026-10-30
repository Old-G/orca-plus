// Custom build (hq-plus-map): HQ+'s one reply box — the text, the microphone and «send» in a row, and
// where it goes («→ chat») on its own line under the box (owner, 31.10: one field for every card, not
// five copies). A card's answer, telling the drafting agent, a report's decisions, work for a thread and
// a chat's reply all use it.
import { useRef } from 'react'
import { HqCommandDictation } from '../hq/HqCommandDictation'
import { HqPlusReplyField } from './HqPlusReplyField'

export function HqPlusComposer({
  id,
  label,
  value,
  placeholder,
  busy,
  canSend = true,
  to,
  sendLabel,
  className,
  onChange,
  onSubmit
}: {
  id: string
  /** What the field is for, read out by a screen reader. */
  label: string
  value: string
  placeholder: string
  busy: boolean
  /** False while something it needs is missing (the HQ workspace for a report's decisions). */
  canSend?: boolean
  /** Where the text goes, shown under the box; null shows nothing. */
  to: React.ReactNode
  sendLabel: string
  className?: string
  onChange: (value: string) => void
  onSubmit: () => void
}): React.JSX.Element {
  const field = useRef<HTMLTextAreaElement>(null)
  const ready = !busy && canSend && value.trim() !== ''
  return (
    <div className="hqp-composer-box">
      <form
        className={className ? `hqp-reply ${className}` : 'hqp-reply'}
        onSubmit={(event) => {
          event.preventDefault()
          if (ready) {
            onSubmit()
          }
        }}
      >
        <label className="hqp-sr" htmlFor={id}>
          {label}
        </label>
        <HqPlusReplyField
          id={id}
          fieldRef={field}
          value={value}
          disabled={busy}
          placeholder={placeholder}
          onChange={(event) => onChange(event.target.value)}
        />
        <HqCommandDictation textareaRef={field} disabled={busy} />
        <button type="submit" className="hqp-go" disabled={!ready} aria-label={sendLabel}>
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
      {to ? <div className="hqp-composer-to">→ {to}</div> : null}
    </div>
  )
}

// Custom build (hq-closing): the editors under a «Ready for you» row — a text for the agent (rework)
// or for ClickUp (the comment), typed or dictated, sent on click; and the Time Estimate buttons.
import { useRef, useState } from 'react'
import { parseHqHours } from '../../../../../shared/hq-closing'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { translate } from '@/i18n/i18n'
import { HqCommandDictation } from './HqCommandDictation'

export function HqReadyTextPanel({
  label,
  initial,
  sendLabel,
  hint,
  onSend,
  onCancel
}: {
  label: string
  initial: string
  sendLabel: string
  hint: string
  /** Resolves to an error to show, or null once sent. */
  onSend: (text: string) => Promise<string | null>
  onCancel: () => void
}): React.JSX.Element {
  const [text, setText] = useState(initial)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const send = async (): Promise<void> => {
    setSending(true)
    const failure = await onSend(text.trim())
    setSending(false)
    setError(failure)
  }
  return (
    <div className="flex flex-col gap-1.5 pl-22">
      <div className="flex items-start gap-2">
        <Textarea
          ref={textareaRef}
          className="min-h-24 flex-1"
          value={text}
          disabled={sending}
          onChange={(event) => setText(event.target.value)}
          aria-label={label}
        />
        <HqCommandDictation textareaRef={textareaRef} disabled={sending} />
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <Button
          type="button"
          size="xs"
          disabled={sending || !text.trim()}
          onClick={() => void send()}
        >
          {sending ? translate('auto.hq.triage.sending', 'Sending…') : sendLabel}
        </Button>
        <Button type="button" variant="ghost" size="xs" disabled={sending} onClick={onCancel}>
          {translate('auto.hq.project.cancel', 'Cancel')}
        </Button>
        <span className="text-[11px] text-muted-foreground">{hint}</span>
      </div>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  )
}

const PRESET_HOURS = [1, 2, 4, 8] as const

export function HqReadyHours({
  identifier,
  hours,
  onSet
}: {
  identifier: string
  hours: number | undefined
  /** Resolves to an error to show, or null once ClickUp has it. */
  onSet: (hours: number) => Promise<string | null>
}): React.JSX.Element {
  const [custom, setCustom] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const set = async (value: number): Promise<void> => {
    setBusy(true)
    const failure = await onSet(value)
    setBusy(false)
    setError(failure)
    if (!failure) {
      setCustom('')
    }
  }
  const typed = parseHqHours(custom)
  return (
    <div className="flex flex-wrap items-center gap-1.5 pl-22">
      <span className="text-[11px] text-muted-foreground">
        {hours
          ? translate('auto.hq.ready.hoursSet', 'Time Estimate: {{value0}} h', { value0: hours })
          : translate('auto.hq.ready.hours', 'Time Estimate:')}
      </span>
      {PRESET_HOURS.map((preset) => (
        <Button
          key={preset}
          type="button"
          variant="outline"
          size="xs"
          disabled={busy}
          onClick={() => void set(preset)}
        >
          {translate('auto.hq.ready.hoursPreset', '{{value0}} h', { value0: preset })}
        </Button>
      ))}
      <Input
        className="w-20"
        value={custom}
        disabled={busy}
        onChange={(event) => setCustom(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && typed) {
            void set(typed)
          }
        }}
        placeholder={translate('auto.hq.ready.hoursOther', 'other')}
        aria-label={translate('auto.hq.ready.hoursFor', 'Hours for {{value0}}', {
          value0: identifier
        })}
      />
      <Button
        type="button"
        variant="outline"
        size="xs"
        disabled={busy || !typed}
        onClick={() => (typed ? void set(typed) : undefined)}
      >
        {translate('auto.hq.ready.setHours', 'Set')}
      </Button>
      {error ? <span className="text-xs text-destructive">{error}</span> : null}
    </div>
  )
}

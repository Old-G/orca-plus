// Custom build (hq-voice-prompts): after a dictation, pick what it becomes — as said, a brief for an agent,
// a message in the owner's tone, a ClickUp task spec, or an idea for HQ — edit, then insert where the
// cursor was. Nothing is sent from here.
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import {
  HQ_VOICE_MODES,
  detectHqVoiceMode,
  type HqVoiceMode
} from '../../../../../shared/hq-voice-prompts'
import { insertText } from '@/components/dictation/dictation-insertion-target'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { translate } from '@/i18n/i18n'
import { closeHqVoicePreview, useHqVoicePreview, type HqVoicePreview } from './hq-voice-preview'

// Why: after the dialog's close, which hands focus back to where it came from.
const INSERT_AFTER_CLOSE_MS = 50

type ModeText =
  | { status: 'ready'; text: string }
  | { status: 'busy' }
  | { status: 'error'; message: string }

function modeLabel(mode: HqVoiceMode): string {
  switch (mode) {
    case 'raw':
      return translate('auto.hq.voice.mode.raw', 'As said')
    case 'agent':
      return translate('auto.hq.voice.mode.agent', 'For an agent')
    case 'person':
      return translate('auto.hq.voice.mode.person', 'For a person')
    case 'clickup':
      return translate('auto.hq.voice.mode.clickup', 'ClickUp task')
    case 'idea':
      return translate('auto.hq.voice.mode.idea', 'Idea')
  }
}

function PreviewBody({ preview }: { preview: HqVoicePreview }): React.JSX.Element {
  const [detected] = useState(() => detectHqVoiceMode(preview.text))
  const [mode, setMode] = useState<HqVoiceMode>(detected.mode ?? 'raw')
  const [texts, setTexts] = useState<Partial<Record<HqVoiceMode, ModeText>>>(() => ({
    raw: { status: 'ready', text: preview.text }
  }))
  const shown = texts[mode]

  useEffect(() => {
    if (mode === 'raw' || texts[mode]) {
      return
    }
    setTexts((current) => ({ ...current, [mode]: { status: 'busy' } }))
    void window.api.hqProjects
      .voiceRewrite({ mode, text: detected.text || preview.text })
      .catch((error: unknown) => ({ ok: false as const, error: String(error) }))
      .then((result) =>
        setTexts((current) => ({
          ...current,
          [mode]: result.ok
            ? { status: 'ready', text: result.text }
            : { status: 'error', message: result.error }
        }))
      )
  }, [mode, texts, detected.text, preview.text])

  const text = shown?.status === 'ready' ? shown.text : ''
  const setText = (next: string): void =>
    setTexts((current) => ({ ...current, [mode]: { status: 'ready', text: next } }))

  const insert = (): void => {
    const { target } = preview
    closeHqVoicePreview()
    if (!target) {
      return
    }
    // Why: the dialog holds focus until it closes, and a text field takes the paste only while focused.
    window.setTimeout(() => {
      if (target.kind !== 'terminal') {
        target.element.focus()
      }
      insertText(text, target)
    }, INSERT_AFTER_CLOSE_MS)
  }
  const copy = (): void => {
    void navigator.clipboard
      .writeText(text)
      .then(() => toast.success(translate('auto.hq.voice.copied', 'Copied.')))
  }
  const saveIdea = (): void => {
    void window.api.hqProjects.saveIdea({ text }).then((result) => {
      if (result.ok) {
        toast.success(
          translate('auto.hq.voice.ideaSaved', 'Saved to HQ: {{value0}}', { value0: result.path })
        )
        closeHqVoicePreview()
      } else {
        toast.error(result.error)
      }
    })
  }

  return (
    <>
      <ToggleGroup
        type="single"
        variant="outline"
        size="sm"
        value={mode}
        onValueChange={(value) => {
          const next = HQ_VOICE_MODES.find((entry) => entry === value)
          if (next) {
            setMode(next)
          }
        }}
        aria-label={translate('auto.hq.voice.modeLabel', 'What it becomes')}
      >
        {HQ_VOICE_MODES.map((entry) => (
          <ToggleGroupItem key={entry} value={entry}>
            {modeLabel(entry)}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      {shown?.status === 'busy' ? (
        <p className="text-sm text-muted-foreground">
          {translate('auto.hq.voice.rewriting', 'Claude is rewriting it…')}
        </p>
      ) : shown?.status === 'error' ? (
        <p className="text-sm text-destructive">{shown.message}</p>
      ) : (
        <Textarea
          value={text}
          onChange={(event) => setText(event.target.value)}
          rows={10}
          className="max-h-[50vh] resize-y"
          aria-label={translate('auto.hq.voice.result', 'Text to insert')}
        />
      )}
      {mode === 'raw' ? null : (
        <p className="line-clamp-3 text-xs text-muted-foreground">
          {translate('auto.hq.voice.said', 'You said: {{value0}}', { value0: preview.text })}
        </p>
      )}
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={closeHqVoicePreview}>
          {translate('auto.hq.voice.discard', 'Discard')}
        </Button>
        <Button type="button" variant="outline" disabled={!text} onClick={copy}>
          {translate('auto.hq.voice.copy', 'Copy')}
        </Button>
        {mode === 'idea' ? (
          <Button type="button" variant="outline" disabled={!text} onClick={saveIdea}>
            {translate('auto.hq.voice.saveIdea', 'Save to HQ ideas')}
          </Button>
        ) : null}
        <Button type="button" disabled={!text || !preview.target} onClick={insert}>
          {translate('auto.hq.voice.insert', 'Insert')}
        </Button>
      </DialogFooter>
    </>
  )
}

export function HqVoicePreviewDialog(): React.JSX.Element {
  const preview = useHqVoicePreview()
  return (
    <Dialog
      open={preview !== null}
      onOpenChange={(open) => (open ? undefined : closeHqVoicePreview())}
    >
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{translate('auto.hq.voice.title', 'Voice prompt')}</DialogTitle>
          <DialogDescription>
            {translate(
              'auto.hq.voice.description',
              'Pick what your dictation becomes, edit it, and insert it where the cursor was. Nothing is sent from here.'
            )}
          </DialogDescription>
        </DialogHeader>
        {preview ? <PreviewBody key={preview.text} preview={preview} /> : null}
      </DialogContent>
    </Dialog>
  )
}

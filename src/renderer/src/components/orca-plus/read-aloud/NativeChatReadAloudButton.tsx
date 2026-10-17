// Custom build (hq-read-aloud): a speaker beside the model picker — reads the agent's latest answer in
// Russian at the chosen speed, or every new answer when «Read new answers» is on.
import { useEffect, useMemo, useRef, useState } from 'react'
import { Square, Volume2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import type { NativeChatMessage } from '../../../../../shared/native-chat-types'
import {
  READ_ALOUD_RATES,
  readAloudAvailable,
  russianVoices,
  startReadAloud,
  stopReadAloud,
  useReadAloudKey
} from './read-aloud-speech'
import { lastAnswerText, speakableText } from './read-aloud-text'

type ReadAloudSettings = { rate: number; voiceURI: string | null; auto: boolean }
const DEFAULTS: ReadAloudSettings = { rate: 1.5, voiceURI: null, auto: false }

export type NativeChatReadAloudSource = {
  /** The chat this composer belongs to; one chat reads at a time. */
  key: string
  messages: readonly NativeChatMessage[]
}

function rateLabel(rate: number): string {
  return `${rate}×`
}

export function NativeChatReadAloudButton({
  source,
  isWorking
}: {
  source: NativeChatReadAloudSource
  isWorking: boolean
}): React.JSX.Element | null {
  const settings = useAppStore((s) => s.settings?.hqReadAloud) ?? DEFAULTS
  const updateSettings = useAppStore((s) => s.updateSettings)
  const speakingKey = useReadAloudKey()
  const speaking = speakingKey === source.key
  const [voices, setVoices] = useState(() => russianVoices())
  const answer = useMemo(() => speakableText(lastAnswerText(source.messages)), [source.messages])

  useEffect(() => {
    const speech = readAloudAvailable() ? window.speechSynthesis : null
    if (!speech) {
      return
    }
    // Why: the system lists its voices asynchronously, after the first read.
    const refresh = (): void => setVoices(russianVoices())
    speech.addEventListener('voiceschanged', refresh)
    return () => speech.removeEventListener('voiceschanged', refresh)
  }, [])

  const read = (): void =>
    startReadAloud(source.key, answer, { rate: settings.rate, voiceURI: settings.voiceURI })
  const change = (next: Partial<ReadAloudSettings>): void =>
    void updateSettings({ hqReadAloud: { ...settings, ...next } })

  // Why: «Read new answers» speaks a turn once it ends, not every streamed piece of it.
  const wasWorking = useRef(isWorking)
  const autoRead = useRef(read)
  autoRead.current = read
  useEffect(() => {
    if (wasWorking.current && !isWorking && settings.auto) {
      autoRead.current()
    }
    wasWorking.current = isWorking
  }, [isWorking, settings.auto])

  if (!readAloudAvailable()) {
    return null
  }
  const label = speaking
    ? translate('auto.hq.readAloud.stop', 'Stop reading')
    : translate('auto.hq.readAloud.title', 'Read aloud')

  if (speaking) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="secondary"
            size="icon-sm"
            aria-label={label}
            onClick={stopReadAloud}
            className="pointer-coarse:size-11"
          >
            <Square className="size-3.5 fill-current" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="top" sideOffset={4}>
          {label}
        </TooltipContent>
      </Tooltip>
    )
  }
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={label}
              className="pointer-coarse:size-11"
            >
              <Volume2 className="size-4" />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="top" sideOffset={4}>
          {label}
        </TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" side="top" collisionPadding={8} className="w-60">
        <DropdownMenuItem disabled={!answer} onSelect={read}>
          <Volume2 className="size-3.5" />
          {translate('auto.hq.readAloud.read', 'Read the last answer')}
        </DropdownMenuItem>
        <DropdownMenuCheckboxItem
          checked={settings.auto}
          onCheckedChange={(checked) => change({ auto: checked === true })}
        >
          {translate('auto.hq.readAloud.auto', 'Read new answers')}
        </DropdownMenuCheckboxItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>{translate('auto.hq.readAloud.speed', 'Speed')}</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={String(settings.rate)}
          onValueChange={(value) => change({ rate: Number(value) })}
        >
          {READ_ALOUD_RATES.map((rate) => (
            <DropdownMenuRadioItem key={rate} value={String(rate)}>
              {rateLabel(rate)}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        {voices.length > 1 ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>{translate('auto.hq.readAloud.voice', 'Voice')}</DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={settings.voiceURI ?? voices[0]?.voiceURI ?? ''}
              onValueChange={(value) => change({ voiceURI: value })}
            >
              {voices.map((voice) => (
                <DropdownMenuRadioItem key={voice.voiceURI} value={voice.voiceURI}>
                  {voice.name}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

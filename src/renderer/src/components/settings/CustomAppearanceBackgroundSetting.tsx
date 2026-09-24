import { useEffect, useState } from 'react'
import type React from 'react'
import { ImageIcon, Trash2 } from 'lucide-react'
import {
  BACKGROUND_DEFAULT_OPACITY,
  BACKGROUND_MAX_BLUR_PX,
  normalizeCustomAppearanceBackground,
  type BackgroundImageErrorCode,
  type CustomAppearanceBackground
} from '../../../../shared/custom-appearance-background'
import type { GlobalSettings } from '../../../../shared/global-settings-types'
import { translate } from '@/i18n/i18n'
import { Button } from '../ui/button'
import { Slider } from '../ui/slider'
import { SearchableSetting } from './SearchableSetting'
import { SettingsRow } from './SettingsFormControls'

type CustomAppearanceBackgroundSettingProps = {
  settings: GlobalSettings
  updateSettings: (updates: Partial<GlobalSettings>) => void
}

function describeError(code: BackgroundImageErrorCode): string {
  switch (code) {
    case 'unsupported':
      return translate(
        'settings.appearance.customAppearance.background.errorUnsupported',
        'Pick a PNG, JPG, WebP or GIF image.'
      )
    case 'too-large':
      return translate(
        'settings.appearance.customAppearance.background.errorTooLarge',
        'The image is larger than 25 MB.'
      )
    case 'unreadable':
      return translate(
        'settings.appearance.customAppearance.background.errorUnreadable',
        'Could not read the selected file.'
      )
    case 'save-failed':
      return translate(
        'settings.appearance.customAppearance.background.errorSaveFailed',
        'Could not save the image.'
      )
  }
}

function BackgroundSlider({
  label,
  value,
  max,
  step,
  format,
  onCommit
}: {
  label: string
  value: number
  max: number
  step: number
  format: (value: number) => string
  onCommit: (value: number) => void
}): React.JSX.Element {
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])
  return (
    <div className="space-y-2">
      <div className="flex justify-between text-xs">
        <span>{label}</span>
        <span className="text-muted-foreground">{format(draft)}</span>
      </div>
      <Slider
        value={[draft]}
        min={0}
        max={max}
        step={step}
        thumbLabels={[label]}
        thumbValueLabels={[format(draft)]}
        onValueChange={([next]) => setDraft(next)}
        onValueCommit={([next]) => onCommit(next)}
      />
    </div>
  )
}

/** Custom build (appearance-background): choose, tune and remove the window background image. */
export function CustomAppearanceBackgroundSetting({
  settings,
  updateSettings
}: CustomAppearanceBackgroundSettingProps): React.JSX.Element {
  const background = normalizeCustomAppearanceBackground(settings.customAppearanceBackground)
  const [error, setError] = useState<BackgroundImageErrorCode | null>(null)
  const title = translate('settings.appearance.customAppearance.background.title', 'Background')
  const description = translate(
    'settings.appearance.customAppearance.background.description',
    'A picture drawn over the whole window. Clicks pass through it.'
  )
  const update = (next: Partial<CustomAppearanceBackground>): void => {
    if (background) {
      updateSettings({ customAppearanceBackground: { ...background, ...next } })
    }
  }

  const choose = async (): Promise<void> => {
    const result = await window.api.customAppearanceBackground.pick()
    if (!result) {
      return
    }
    if ('error' in result) {
      setError(result.error)
      return
    }
    setError(null)
    updateSettings({
      customAppearanceBackground: {
        fileName: result.fileName,
        opacity: background?.opacity ?? BACKGROUND_DEFAULT_OPACITY,
        blur: background?.blur ?? 0
      }
    })
  }

  const remove = async (): Promise<void> => {
    updateSettings({ customAppearanceBackground: null })
    await window.api.customAppearanceBackground.clear()
  }

  return (
    <SearchableSetting
      title={title}
      description={description}
      keywords={['background', 'wallpaper', 'image', 'picture']}
    >
      <SettingsRow
        label={title}
        description={description}
        control={
          <div className="flex gap-2">
            <Button variant="outline" size="xs" onClick={() => void choose()}>
              <ImageIcon className="size-3.5" />
              {background
                ? translate('settings.appearance.customAppearance.background.replace', 'Replace…')
                : translate(
                    'settings.appearance.customAppearance.background.choose',
                    'Choose image…'
                  )}
            </Button>
            {background ? (
              <Button variant="outline" size="xs" onClick={() => void remove()}>
                <Trash2 className="size-3.5" />
                {translate('settings.appearance.customAppearance.background.remove', 'Remove')}
              </Button>
            ) : null}
          </div>
        }
      />
      {error ? <p className="pb-3 text-xs text-destructive">{describeError(error)}</p> : null}
      {background ? (
        <div className="space-y-4 pb-4">
          <BackgroundSlider
            label={translate('settings.appearance.customAppearance.background.opacity', 'Opacity')}
            value={background.opacity}
            max={1}
            step={0.01}
            format={(value) => `${Math.round(value * 100)}%`}
            onCommit={(opacity) => update({ opacity })}
          />
          <BackgroundSlider
            label={translate('settings.appearance.customAppearance.background.blur', 'Blur')}
            value={background.blur}
            max={BACKGROUND_MAX_BLUR_PX}
            step={1}
            format={(value) => `${value}px`}
            onCommit={(blur) => update({ blur })}
          />
        </div>
      ) : null}
    </SearchableSetting>
  )
}

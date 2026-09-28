// Custom build (hq-roster-sync): where the HQ meta-wiki lives; empty turns the sync off.
import React, { useEffect, useId, useRef, useState } from 'react'
import { FolderOpen } from 'lucide-react'
import type { GlobalSettings } from '../../../../shared/global-settings-types'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Label } from '../ui/label'
import { SearchableSetting } from './SearchableSetting'
import { isImeCompositionKeyDown } from '@/lib/ime-composition-keyboard-event'
import { translate } from '@/i18n/i18n'

type HqPathSettingProps = {
  settings: GlobalSettings
  updateSettings: (updates: Partial<GlobalSettings>) => void
}

export function HqPathSetting({ settings, updateSettings }: HqPathSettingProps): React.JSX.Element {
  const inputId = useId()
  const value = settings.hqPath ?? ''
  const [draft, setDraft] = useState(value)
  const skipNextBlurCommitRef = useRef(false)

  useEffect(() => {
    setDraft(value)
  }, [value])

  const commit = (next: string): void => {
    const trimmed = next.trim()
    if (trimmed !== value) {
      updateSettings({ hqPath: trimmed === '' ? null : trimmed })
    }
  }

  const handleBrowse = async (): Promise<void> => {
    try {
      const path = await window.api.repos.pickFolder()
      if (path) {
        setDraft(path)
        commit(path)
      }
    } finally {
      skipNextBlurCommitRef.current = false
    }
  }

  const title = translate('auto.hq.setting.title', 'HQ Folder')
  const description = translate(
    'auto.hq.setting.description',
    'Meta-wiki over all your projects. Adding or removing a project updates its registry and pages.'
  )

  return (
    <SearchableSetting
      title={title}
      description={description}
      keywords={['hq', 'wiki', 'registry', 'strata', 'projects']}
      className="space-y-2"
    >
      <Label htmlFor={inputId}>{title}</Label>
      <div className="flex gap-2">
        <Input
          id={inputId}
          value={draft}
          placeholder={translate('auto.hq.setting.placeholder', 'Not set — sync is off')}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => {
            if (skipNextBlurCommitRef.current) {
              skipNextBlurCommitRef.current = false
              return
            }
            commit(draft)
          }}
          onKeyDown={(e) => {
            if (isImeCompositionKeyDown(e)) {
              return
            }
            if (e.key === 'Enter') {
              skipNextBlurCommitRef.current = true
              commit(draft)
              e.currentTarget.blur()
              return
            }
            if (e.key === 'Escape') {
              skipNextBlurCommitRef.current = true
              setDraft(value)
              e.currentTarget.blur()
            }
          }}
          className="flex-1"
        />
        <Button
          variant="outline"
          size="sm"
          onPointerDown={() => {
            skipNextBlurCommitRef.current = true
          }}
          onClick={() => void handleBrowse()}
          className="shrink-0"
        >
          <FolderOpen className="size-3.5" />
          {translate(
            'auto.components.settings.GeneralWorkspaceSettingsSection.5567191a6e',
            'Browse'
          )}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">{description}</p>
    </SearchableSetting>
  )
}

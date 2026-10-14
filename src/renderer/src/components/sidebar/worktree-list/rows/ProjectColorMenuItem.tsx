// Custom build (hq-chats): «Project color» in the project menu — the palette in one click; «Auto»
// returns the project to the color HQ and the sidebar pick for it from its id.
import React from 'react'
import { Check, Palette } from 'lucide-react'
import {
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger
} from '@/components/ui/dropdown-menu'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import { DEFAULT_REPO_BADGE_COLOR, REPO_COLORS } from '../../../../../../shared/constants'
import { projectAccentColor } from '../../../../../../shared/project-accent-color'
import type { Repo } from '../../../../../../shared/repo-types'

const PICKABLE = REPO_COLORS.filter((color) => color !== DEFAULT_REPO_BADGE_COLOR)

function Swatch({ color }: { color: string }): React.JSX.Element {
  return (
    <span aria-hidden className="size-3 shrink-0 rounded-sm" style={{ backgroundColor: color }} />
  )
}

export function ProjectColorMenuItem({ repo }: { repo: Repo }): React.JSX.Element {
  const picked = repo.badgeColor?.toLowerCase()
  const isAuto = !picked || picked === DEFAULT_REPO_BADGE_COLOR
  const setColor = (badgeColor: string): void => {
    void useAppStore.getState().updateRepo(repo.id, { badgeColor })
  }
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        <Palette className="size-3.5" />
        {translate('auto.sidebar.projectColor', 'Project color')}
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent>
        <DropdownMenuItem onSelect={() => setColor(DEFAULT_REPO_BADGE_COLOR)}>
          <Swatch color={projectAccentColor(repo.id)} />
          {translate('auto.sidebar.projectColorAuto', 'Auto')}
          {isAuto ? <Check className="ml-auto size-3.5" /> : null}
        </DropdownMenuItem>
        {PICKABLE.map((color) => (
          <DropdownMenuItem key={color} onSelect={() => setColor(color)}>
            <Swatch color={color} />
            <span className="font-mono text-xs">{color}</span>
            {!isAuto && picked === color ? <Check className="ml-auto size-3.5" /> : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  )
}

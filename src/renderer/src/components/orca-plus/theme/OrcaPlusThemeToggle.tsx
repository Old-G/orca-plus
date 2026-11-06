// Custom build (paper-theme): the sun/moon right of «HQ+ | HQ | Code» — one click flips dark ↔ Paper
// (owner, 06.11). The icon is what a click switches to.
import { Moon, Sun } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useDocumentDarkTheme } from '@/hooks/use-document-dark-theme'
import { translate } from '@/i18n/i18n'
import { toggleOrcaPlusTheme } from './orca-plus-theme-actions'

// Why: the titlebar is a window-drag region; controls in it must opt out to take clicks.
const NO_DRAG: React.CSSProperties & { WebkitAppRegion: string } = { WebkitAppRegion: 'no-drag' }

export function OrcaPlusThemeToggle(): React.JSX.Element {
  const dark = useDocumentDarkTheme()
  const label = dark
    ? translate('auto.orcaPlus.theme.toPaper', 'Switch to Paper (light)')
    : translate('auto.orcaPlus.theme.toDark', 'Switch to Dark')
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className="sidebar-toggle ml-1"
          style={NO_DRAG}
          aria-label={label}
          onClick={() => toggleOrcaPlusTheme()}
        >
          {dark ? <Sun size={15} /> : <Moon size={15} />}
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={6}>
        {label}
      </TooltipContent>
    </Tooltip>
  )
}

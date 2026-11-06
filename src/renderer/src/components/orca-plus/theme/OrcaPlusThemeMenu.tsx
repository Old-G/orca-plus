// Custom build (paper-theme): HQ+'s theme menu next to Brain — Dark, Paper, Auto: Paper on battery,
// Auto: follow macOS (owner, 06.11). The pill shows the icon of what is on screen now.
import { Moon, Sun } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { useDocumentDarkTheme } from '@/hooks/use-document-dark-theme'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import { setOrcaPlusThemeMode } from './orca-plus-theme-actions'
import {
  ORCA_PLUS_THEME_MODES,
  themeModeOf,
  useThemeFollowsBattery,
  type OrcaPlusThemeMode
} from './orca-plus-theme-mode'

export function orcaPlusThemeModeLabel(mode: OrcaPlusThemeMode): string {
  switch (mode) {
    case 'dark':
      return translate('auto.orcaPlus.theme.dark', 'Dark')
    case 'paper':
      return translate('auto.orcaPlus.theme.paper', 'Paper')
    case 'auto-battery':
      return translate('auto.orcaPlus.theme.autoBattery', 'Auto: Paper on battery')
    case 'auto-system':
      return translate('auto.orcaPlus.theme.autoSystem', 'Auto: follow macOS')
  }
}

export function OrcaPlusThemeMenu(): React.JSX.Element {
  const theme = useAppStore((s) => s.settings?.theme ?? 'system')
  const followsBattery = useThemeFollowsBattery()
  const dark = useDocumentDarkTheme()
  const mode = themeModeOf(theme, followsBattery)
  const label = translate('auto.orcaPlus.theme.menu', 'Theme: {{mode}}', {
    mode: orcaPlusThemeModeLabel(mode)
  })
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className="hqp-pill hqp-theme-btn" aria-label={label} title={label}>
          {dark ? <Moon size={13} aria-hidden="true" /> : <Sun size={13} aria-hidden="true" />}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="hq-plus-pop min-w-56">
        <DropdownMenuRadioGroup
          value={mode}
          onValueChange={(value) => void setOrcaPlusThemeMode(value as OrcaPlusThemeMode)}
        >
          {ORCA_PLUS_THEME_MODES.map((item) => (
            <DropdownMenuRadioItem key={item} value={item}>
              {orcaPlusThemeModeLabel(item)}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

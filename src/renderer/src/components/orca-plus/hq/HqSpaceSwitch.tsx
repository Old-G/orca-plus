// Custom build (hq-spaces): the workspace picker in HQ's header — «All» or one workspace, each with
// its colour; hidden until the global HQ has a workspace.
import { useState } from 'react'
import { ChevronDown, KeyRound } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { HqSpaceKeysDialog } from './HqSpaceKeysDialog'
import { translate } from '@/i18n/i18n'
import type { HqSpacesView } from './use-hq-spaces'

const ALL = '__all__'

function Dot({ color }: { color: string | null }): React.JSX.Element {
  return (
    <span
      aria-hidden="true"
      className="inline-block size-2 shrink-0 rounded-full bg-muted-foreground"
      style={color ? { backgroundColor: color } : undefined}
    />
  )
}

export function HqSpaceSwitch({ view }: { view: HqSpacesView }): React.JSX.Element | null {
  const [keysOpen, setKeysOpen] = useState(false)
  if (view.spaces.length === 0) {
    return null
  }
  const all = translate('auto.hq.spaces.all', 'All workspaces')
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="xs"
            aria-label={translate('auto.hq.spaces.label', 'Workspace')}
          >
            <Dot color={view.active?.color ?? null} />
            <span className="max-w-32 truncate">{view.active?.name ?? all}</span>
            <ChevronDown className="size-3 text-muted-foreground" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuRadioGroup
            value={view.active?.slug ?? ALL}
            onValueChange={(value) => view.setActive(value === ALL ? null : value)}
          >
            <DropdownMenuRadioItem value={ALL}>
              <Dot color={null} />
              {all}
            </DropdownMenuRadioItem>
            {view.spaces.map((space) => (
              <DropdownMenuRadioItem key={space.slug} value={space.slug}>
                <Dot color={space.color} />
                {space.name}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setKeysOpen(true)}>
            <KeyRound />
            {translate('auto.hq.spaceKeys.open', 'Workspace keys…')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <HqSpaceKeysDialog open={keysOpen} onOpenChange={setKeysOpen} spaces={view.spaces} />
    </>
  )
}

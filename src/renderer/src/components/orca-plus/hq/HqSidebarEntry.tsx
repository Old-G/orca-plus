// Custom build (hq): the sidebar entry that opens HQ, styled as its Skills/Artifacts siblings; it
// also carries the morning count of deferred sessions, since it is always mounted.
import { Castle } from 'lucide-react'
import { translate } from '@/i18n/i18n'
import { isWebClientLocation } from '@/lib/web-client-location'
import { useAppStore } from '@/store'
import { HqDeferredBell } from './HqDeferredBell'
import { closeHqScreen, openHqScreen } from './hq-view'

export function HqSidebarEntry(): React.JSX.Element | null {
  const active = useAppStore((s) => s.activeView === 'hq')
  return (
    <>
      {/* Why desktop only: the bell's morning lines are raised by the desktop, never twice. */}
      {isWebClientLocation() ? null : <HqDeferredBell />}
      <button
        type="button"
        onClick={() => (active ? closeHqScreen() : openHqScreen())}
        aria-current={active ? 'page' : undefined}
        className="group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] font-medium tracking-tight text-worktree-sidebar-foreground/60 transition-colors hover:bg-worktree-sidebar-foreground/8 aria-[current=page]:bg-worktree-sidebar-accent aria-[current=page]:text-worktree-sidebar-accent-foreground"
      >
        <Castle
          className="size-4 shrink-0 text-worktree-sidebar-foreground/30 group-aria-[current=page]:text-current"
          strokeWidth={active ? 2.25 : 1.75}
        />
        <span className="flex-1">{translate('auto.hq.title', 'HQ')}</span>
      </button>
    </>
  )
}

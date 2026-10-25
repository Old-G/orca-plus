// Custom build (hq-plus-chats-by-project): «+ New chat» in HQ+'s chats — every project of the sidebar in
// one scrolling list with a search, the active ones first; a click starts a chat there (owner, 25.10).
import { useMemo, useState } from 'react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import { isImeOwnedKeyboardEvent } from '@/lib/ime-composition-keyboard-event'
import { startHqChat } from '../hq/hq-new-chat'
import type { HqPlusTile } from './HqPlusSide'

type Pick = { repoId: string; name: string; worktreeId: string }

function tileStyle(color: string): React.CSSProperties & Record<'--hqp-room', string> {
  return { '--hqp-room': color }
}

/** The workspace a new chat of a project opens in: its main checkout, else its first live one. */
function useHqPlusNewChatTargets(activeRepoIds: readonly string[]): Pick[] {
  const repos = useAppStore((state) => state.repos)
  const worktreesByRepo = useAppStore((state) => state.worktreesByRepo)
  return useMemo(() => {
    const picks = repos.flatMap((repo) => {
      const worktrees = (worktreesByRepo[repo.id] ?? []).filter((worktree) => !worktree.isArchived)
      const worktree = worktrees.find((candidate) => candidate.isMainWorktree) ?? worktrees[0]
      return worktree ? [{ repoId: repo.id, name: repo.displayName, worktreeId: worktree.id }] : []
    })
    const rank = (pick: Pick): number => {
      const index = activeRepoIds.indexOf(pick.repoId)
      return index === -1 ? activeRepoIds.length : index
    }
    return picks.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name))
  }, [activeRepoIds, repos, worktreesByRepo])
}

export function HqPlusNewChat({
  activeRepoIds,
  tileOf
}: {
  /** The projects listed in the column, which lead the picker in that order. */
  activeRepoIds: readonly string[]
  tileOf: (repoId: string, name: string) => HqPlusTile
}): React.JSX.Element {
  const targets = useHqPlusNewChatTargets(activeRepoIds)
  const activeCount = targets.filter((target) => activeRepoIds.includes(target.repoId)).length
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const needle = query.trim().toLowerCase()
  const shown = needle
    ? targets.filter((target) => target.name.toLowerCase().includes(needle))
    : targets
  const start = (target: Pick): void => {
    setOpen(false)
    setQuery('')
    void startHqChat(target.worktreeId)
  }
  const row = (target: Pick): React.JSX.Element => {
    const tile = tileOf(target.repoId, target.name)
    return (
      <button
        key={target.repoId}
        type="button"
        className="hqp-newchat-opt"
        onClick={() => start(target)}
      >
        <span
          className="hqp-tile"
          style={tile.color ? tileStyle(tile.color) : undefined}
          aria-hidden="true"
        >
          {tile.letters}
        </span>
        <span className="hqp-newchat-name">{target.name}</span>
      </button>
    )
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" className="hqp-pill hqp-newchat-btn">
          {translate('auto.hqPlus.side.newChat', '+ New chat')}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="hq-plus-pop hqp-newchat w-80 p-2">
        <input
          className="hqp-roomform-in hqp-newchat-q"
          aria-label={translate('auto.hqPlus.side.newChatSearch', 'Project')}
          placeholder={translate('auto.hqPlus.side.newChatPlaceholder', 'Project…')}
          value={query}
          autoFocus
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !isImeOwnedKeyboardEvent(event) && shown[0]) {
              start(shown[0])
            }
          }}
        />
        <div className="hqp-newchat-list scrollbar-sleek">
          {needle ? (
            shown.map(row)
          ) : (
            <>
              {activeCount > 0 ? (
                <div className="hqp-newchat-h">
                  {translate('auto.hqPlus.side.newChatActive', 'Active')}
                </div>
              ) : null}
              {targets.slice(0, activeCount).map(row)}
              <div className="hqp-newchat-h">
                {translate('auto.hqPlus.side.newChatAll', 'All projects')}
              </div>
              {targets.slice(activeCount).map(row)}
            </>
          )}
          {shown.length === 0 ? (
            <p className="hqp-empty hqp-quiet">
              {translate('auto.hqPlus.side.newChatNone', 'no such project')}
            </p>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  )
}

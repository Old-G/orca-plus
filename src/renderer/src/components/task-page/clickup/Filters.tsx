import { LoaderCircle, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { shouldSuppressEnterSubmit } from '@/lib/new-workspace-enter-guard'
import { cn } from '@/lib/utils'
import { translate } from '@/i18n/i18n'
import type { ClickUpTaskScope } from '../../../../../shared/clickup-types'
import type { ClickUpTaskListState } from './use-clickup-task-list'

const ALL = '__all__'

function PresetButton({
  active,
  label,
  onClick
}: {
  active: boolean
  label: string
  onClick: () => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'rounded-md border border-border/50 px-2 py-1 text-xs transition',
        active
          ? 'bg-foreground/90 text-background'
          : 'bg-transparent text-foreground hover:bg-muted/50'
      )}
    >
      {label}
    </button>
  )
}

export function ClickUpTaskFilters({ state }: { state: ClickUpTaskListState }): React.JSX.Element {
  const { filter, setFilter, spaces, lists, loading } = state
  const setScope = (scope: ClickUpTaskScope): void => setFilter({ ...filter, scope })

  return (
    <div className="rounded-md rounded-b-none border border-border/50 bg-muted/50 px-3 pt-2 pb-3 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <PresetButton
            active={filter.scope === 'mine'}
            label={translate('auto.components.task-page.clickup.Filters.mine', 'Assigned to me')}
            onClick={() => setScope('mine')}
          />
          <PresetButton
            active={filter.scope === 'all'}
            label={translate('auto.components.task-page.clickup.Filters.all', 'Everyone')}
            onClick={() => setScope('all')}
          />
          <PresetButton
            active={filter.includeDone === true}
            label={translate(
              'auto.components.task-page.clickup.Filters.includeDone',
              'Include done'
            )}
            onClick={() => setFilter({ ...filter, includeDone: !filter.includeDone })}
          />
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Select
            value={filter.spaceId ?? ALL}
            onValueChange={(value) =>
              setFilter({
                scope: filter.scope,
                includeDone: filter.includeDone,
                ...(value === ALL ? {} : { spaceId: value })
              })
            }
          >
            <SelectTrigger
              size="sm"
              className="w-44"
              aria-label={translate('auto.components.task-page.clickup.Filters.space', 'Space')}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>
                {translate('auto.components.task-page.clickup.Filters.allSpaces', 'All spaces')}
              </SelectItem>
              {spaces.map((space) => (
                <SelectItem key={space.id} value={space.id}>
                  {space.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {filter.spaceId ? (
            <Select
              value={filter.listId ?? ALL}
              onValueChange={(value) =>
                setFilter({
                  scope: filter.scope,
                  includeDone: filter.includeDone,
                  spaceId: filter.spaceId,
                  ...(value === ALL ? {} : { listId: value })
                })
              }
            >
              <SelectTrigger
                size="sm"
                className="w-52"
                aria-label={translate('auto.components.task-page.clickup.Filters.list', 'List')}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>
                  {translate('auto.components.task-page.clickup.Filters.allLists', 'All lists')}
                </SelectItem>
                {lists.map((list) => (
                  <SelectItem key={list.id} value={list.id}>
                    {list.folderName ? `${list.folderName} / ${list.name}` : list.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="outline"
                size="icon-sm"
                onClick={state.refresh}
                disabled={loading}
                aria-label={translate(
                  'auto.components.task-page.clickup.Filters.refresh',
                  'Refresh ClickUp tasks'
                )}
              >
                {loading ? <LoaderCircle className="animate-spin" /> : <RefreshCw />}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom" sideOffset={6}>
              {translate(
                'auto.components.task-page.clickup.Filters.refresh',
                'Refresh ClickUp tasks'
              )}
            </TooltipContent>
          </Tooltip>
        </div>
      </div>
      <div className="mt-3">
        <Input
          value={state.searchInput}
          onChange={(event) => {
            state.setSearchInput(event.target.value)
            if (!event.target.value) {
              state.applySearch('')
            }
          }}
          onKeyDown={(event) => {
            if (event.key !== 'Enter') {
              return
            }
            if (
              shouldSuppressEnterSubmit(
                { isComposing: event.nativeEvent.isComposing, shiftKey: event.shiftKey },
                false
              )
            ) {
              return
            }
            event.preventDefault()
            state.applySearch(state.searchInput)
          }}
          placeholder={translate(
            'auto.components.task-page.clickup.Filters.searchPlaceholder',
            'Search by title, DEV-123 or a ClickUp link, then press Enter'
          )}
          aria-label={translate('auto.components.task-page.clickup.Filters.search', 'Search tasks')}
        />
      </div>
    </div>
  )
}

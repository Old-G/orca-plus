// Custom build (hq): a project card's ClickUp tasks — the open tasks of the list linked to the
// project, each opening the Tasks page's sheet; starting work opens the composer on this project.
import { useMemo, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import type { ClickUpTask, ClickUpTaskSummary } from '../../../../../shared/clickup-types'
import {
  readHqClickUpBinding,
  withHqClickUpBinding
} from '../../../../../shared/hq-project-clickup'
import { ClickUpConnectDialog } from '@/components/clickup-connect-dialog'
import { ClickUpStatusChip } from '@/components/task-page/clickup/TaskList'
import { ClickUpTaskSheet } from '@/components/task-page/clickup/TaskSheet'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { translate } from '@/i18n/i18n'
import {
  buildClickUpLinkedWorkItem,
  getClickUpTaskWorkspaceSeed
} from '@/lib/clickup-linked-work-item'
import { clickUpGetTask } from '@/runtime/runtime-clickup-client'
import { useAppStore } from '@/store'
import {
  filterHqTasks,
  hqStatusOptions,
  readHqTaskFilter,
  toggleHqStatus,
  writeHqTaskFilter,
  type HqTaskFilter
} from './hq-project-task-filter'
import { HqProjectTaskFilters } from './HqProjectTaskFilters'
import { ColumnHeader } from './hq-waiting-parts'
import {
  useHqClickUpConnection,
  useHqClickUpPicker,
  useHqClickUpTasks,
  type HqClickUpConnection
} from './use-hq-project-clickup'

function listLabel(list: { name: string; folderName: string | null }): string {
  return list.folderName ? `${list.folderName} / ${list.name}` : list.name
}

function ListPicker({
  repoId,
  connection,
  initialSpaceId,
  onDone
}: {
  repoId: string
  connection: HqClickUpConnection
  initialSpaceId: string | null
  onDone: () => void
}): React.JSX.Element {
  const [spaceId, setSpaceId] = useState<string | null>(initialSpaceId)
  const [listId, setListId] = useState<string | null>(null)
  const picker = useHqClickUpPicker(connection, true, spaceId)
  const updateSettings = useAppStore((s) => s.updateSettings)
  const save = (): void => {
    const list = picker.lists?.find((candidate) => candidate.id === listId)
    if (!list || !spaceId) {
      return
    }
    const lists = useAppStore.getState().settings?.hqProjectClickUpLists
    void updateSettings({
      hqProjectClickUpLists: withHqClickUpBinding(lists, repoId, {
        listId: list.id,
        listName: listLabel(list),
        spaceId
      })
    }).then(onDone)
  }
  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-muted-foreground">
        {translate(
          'auto.hq.project.pickList',
          'Pick the ClickUp list that holds this project’s tasks.'
        )}
      </p>
      <div className="flex flex-wrap gap-2">
        <Select
          value={spaceId ?? undefined}
          onValueChange={(value) => {
            setSpaceId(value)
            setListId(null)
          }}
          disabled={!picker.spaces}
        >
          <SelectTrigger
            size="sm"
            className="w-44"
            aria-label={translate('auto.hq.project.space', 'Space')}
          >
            <SelectValue placeholder={translate('auto.hq.project.space', 'Space')} />
          </SelectTrigger>
          <SelectContent>
            {(picker.spaces ?? []).map((space) => (
              <SelectItem key={space.id} value={space.id}>
                {space.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={listId ?? undefined} onValueChange={setListId} disabled={!picker.lists}>
          <SelectTrigger
            size="sm"
            className="w-56"
            aria-label={translate('auto.hq.project.list', 'List')}
          >
            <SelectValue placeholder={translate('auto.hq.project.list', 'List')} />
          </SelectTrigger>
          <SelectContent>
            {(picker.lists ?? []).map((list) => (
              <SelectItem key={list.id} value={list.id}>
                {listLabel(list)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button type="button" variant="secondary" size="sm" disabled={!listId} onClick={save}>
          {translate('auto.hq.project.linkList', 'Link')}
        </Button>
        {initialSpaceId ? (
          <Button type="button" variant="ghost" size="sm" onClick={onDone}>
            {translate('auto.hq.project.cancel', 'Cancel')}
          </Button>
        ) : null}
      </div>
      {picker.error ? <p className="text-xs text-destructive">{picker.error}</p> : null}
    </div>
  )
}

function TaskRows({
  tasks,
  onOpen
}: {
  tasks: readonly ClickUpTaskSummary[]
  onOpen: (task: ClickUpTaskSummary) => void
}): React.JSX.Element {
  if (tasks.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        {translate('auto.hq.project.noTasks', 'No open tasks match this filter.')}
      </p>
    )
  }
  return (
    <ul className="flex flex-col">
      {tasks.map((task) => (
        <li key={task.id}>
          <button
            type="button"
            onClick={() => onOpen(task)}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            <span className="w-20 shrink-0 truncate font-mono text-[11px] text-muted-foreground">
              {task.identifier}
            </span>
            <span className="min-w-0 flex-1 truncate text-[13px]">{task.title}</span>
            <span className="hidden w-20 shrink-0 truncate text-xs text-muted-foreground sm:block">
              {task.assignees.map((assignee) => assignee.initials ?? assignee.username).join(', ')}
            </span>
            <ClickUpStatusChip status={task.status} />
          </button>
        </li>
      ))}
    </ul>
  )
}

export function HqProjectTasks({ repoId }: { repoId: string }): React.JSX.Element {
  const connection = useHqClickUpConnection(repoId)
  const lists = useAppStore((s) => s.settings?.hqProjectClickUpLists)
  const binding = useMemo(() => readHqClickUpBinding(lists, repoId), [lists, repoId])
  const [picking, setPicking] = useState(false)
  const [connectOpen, setConnectOpen] = useState(false)
  const [selected, setSelected] = useState<ClickUpTaskSummary | null>(null)
  const openModal = useAppStore((s) => s.openModal)
  const [filter, setFilterState] = useState<HqTaskFilter>(() => readHqTaskFilter(repoId))
  const setFilter = (next: HqTaskFilter): void => {
    setFilterState(next)
    writeHqTaskFilter(repoId, next)
  }
  const tasks = useHqClickUpTasks(
    connection,
    binding && !picking ? binding.listId : null,
    filter.scope
  )
  const loaded = tasks.state.status === 'ready' ? tasks.state.tasks : null
  const options = useMemo(() => hqStatusOptions(loaded ?? []), [loaded])
  const shown = useMemo(
    () => filterHqTasks(loaded ?? [], filter.statuses),
    [loaded, filter.statuses]
  )
  const sourceContext = connection.status === 'ready' ? connection.sourceContext : null
  const title = translate('auto.hq.project.tasks', 'Tasks')

  const startWorkspace = async (task: ClickUpTaskSummary | ClickUpTask): Promise<void> => {
    // Why: the agent prompt carries the task text, so a list row loads the full task first.
    const full =
      'description' in task ? task : await clickUpGetTask(sourceContext, task.id).catch(() => null)
    setSelected(null)
    openModal('new-workspace-composer', {
      linkedWorkItem: buildClickUpLinkedWorkItem(task, full),
      taskSourceContext: sourceContext,
      prefilledName: getClickUpTaskWorkspaceSeed(task),
      initialRepoId: repoId,
      telemetrySource: 'sidebar'
    })
  }

  let body: React.JSX.Element
  if (connection.status === 'checking') {
    body = (
      <p className="text-xs text-muted-foreground">
        {translate('auto.hq.waiting.loading', 'Loading…')}
      </p>
    )
  } else if (connection.status === 'disconnected') {
    body = (
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-xs text-muted-foreground">
          {connection.error ??
            translate('auto.hq.project.clickUpOff', 'Connect ClickUp to see this project’s tasks.')}
        </p>
        <Button type="button" variant="secondary" size="xs" onClick={() => setConnectOpen(true)}>
          {translate('auto.hq.project.connectClickUp', 'Connect ClickUp')}
        </Button>
        <ClickUpConnectDialog open={connectOpen} onOpenChange={setConnectOpen} />
      </div>
    )
  } else if (!binding || picking) {
    body = (
      <ListPicker
        key={binding?.listId ?? 'none'}
        repoId={repoId}
        connection={connection}
        initialSpaceId={binding?.spaceId ?? null}
        onDone={() => setPicking(false)}
      />
    )
  } else {
    body = (
      <>
        <HqProjectTaskFilters
          scope={filter.scope}
          onScope={(scope) => setFilter({ ...filter, scope })}
          options={options}
          statuses={filter.statuses}
          onToggleStatus={(name) =>
            setFilter({ ...filter, statuses: toggleHqStatus(filter.statuses, name) })
          }
        />
        {tasks.state.status === 'ready' ? (
          <TaskRows tasks={shown} onOpen={setSelected} />
        ) : (
          <p className="text-xs text-muted-foreground">
            {tasks.state.status === 'loading'
              ? translate('auto.hq.waiting.loading', 'Loading…')
              : translate('auto.hq.project.tasksFailed', "Couldn't read tasks: {{value0}}", {
                  value0: tasks.state.message
                })}
          </p>
        )}
      </>
    )
  }

  const count = loaded && binding && !picking ? shown.length : 0
  return (
    <section className="flex flex-col gap-2" aria-label={title}>
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <ColumnHeader title={title} count={count} />
        </div>
        {connection.status === 'ready' && binding && !picking ? (
          <>
            <span
              className="min-w-0 truncate text-xs text-muted-foreground"
              title={binding.listName}
            >
              {binding.listName}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              onClick={tasks.refresh}
              aria-label={translate('auto.hq.project.refreshTasks', 'Refresh tasks')}
            >
              <RefreshCw />
            </Button>
            <Button type="button" variant="ghost" size="xs" onClick={() => setPicking(true)}>
              {translate('auto.hq.project.changeList', 'Change list')}
            </Button>
          </>
        ) : null}
      </div>
      {body}
      <ClickUpTaskSheet
        summary={selected}
        sourceContext={sourceContext}
        onClose={() => setSelected(null)}
        onUse={(task) => void startWorkspace(task)}
        onTaskChanged={tasks.refresh}
      />
    </section>
  )
}

// Custom build (hq-sent-history, outgoing-footer): narrows «Done for you» to one project, one ClickUp
// task, or the message a footer's ref names.
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { translate } from '@/i18n/i18n'
import type { HqDoneTask } from './hq-done-journal'

export type HqDoneFilter = { project: string | null; task: string | null; ref: string }

export const NO_HQ_DONE_FILTER: HqDoneFilter = { project: null, task: null, ref: '' }

function Chips({
  label,
  values,
  selected,
  onSelect
}: {
  label: string
  values: readonly { id: string; label: string; title?: string }[]
  selected: string | null
  onSelect: (id: string | null) => void
}): React.JSX.Element {
  return (
    <div className="flex flex-wrap gap-1.5" aria-label={label}>
      <Button
        type="button"
        size="xs"
        variant={selected === null ? 'secondary' : 'ghost'}
        onClick={() => onSelect(null)}
      >
        {translate('auto.hq.done.allProjects', 'All')}
      </Button>
      {values.map((value) => (
        <Button
          key={value.id}
          type="button"
          size="xs"
          title={value.title}
          variant={selected === value.id ? 'secondary' : 'ghost'}
          onClick={() => onSelect(selected === value.id ? null : value.id)}
        >
          {value.label}
        </Button>
      ))}
    </div>
  )
}

export function HqDoneFilters({
  projects,
  tasks,
  filter,
  onChange
}: {
  projects: readonly string[]
  tasks: readonly HqDoneTask[]
  filter: HqDoneFilter
  onChange: (filter: HqDoneFilter) => void
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-start gap-2">
        {projects.length > 0 ? (
          <div className="min-w-0 flex-1">
            <Chips
              label={translate('auto.hq.done.byProject', 'By project')}
              values={projects.map((name) => ({ id: name, label: name }))}
              selected={filter.project}
              onSelect={(project) => onChange({ ...filter, project })}
            />
          </div>
        ) : (
          <div className="flex-1" />
        )}
        <Input
          value={filter.ref}
          onChange={(event) => onChange({ ...filter, ref: event.target.value })}
          placeholder={translate('auto.hq.done.findRef', 'ref…')}
          aria-label={translate('auto.hq.done.findRefLabel', 'Find a message by its ref')}
          className="h-7 w-24"
        />
      </div>
      {tasks.length > 0 ? (
        <Chips
          label={translate('auto.hq.done.byTask', 'By task')}
          values={tasks.map((task) => ({
            id: task.id,
            label: task.id,
            title: task.name ?? undefined
          }))}
          selected={filter.task}
          onSelect={(task) => onChange({ ...filter, task })}
        />
      ) : null}
    </div>
  )
}

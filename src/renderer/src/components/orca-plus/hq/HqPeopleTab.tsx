// Custom build (hq-people): HQ's «People» — everyone in the company's org matrix and anyone else the
// pulse knows, the owner's own people first, then by department; one person's card on the right.
// At phone width the list and the card take turns on the whole width, as in Reports.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { isHqKnownPerson, readHqPeople, type HqPeopleRow } from '../../../../../shared/hq-people'
import { Input } from '@/components/ui/input'
import { translate } from '@/i18n/i18n'
import { HqPersonCard } from './HqPersonCard'
import { ColumnHeader } from './hq-waiting-parts'

const REFRESH_MS = 60_000

type PeopleState = { people: HqPeopleRow[]; error: string | null; loaded: boolean }

function useHqPeople(): PeopleState {
  const [state, setState] = useState<PeopleState>({ people: [], error: null, loaded: false })
  const load = useCallback(async () => {
    const response = await window.api.runtime.call({ method: 'hqProjects.people' })
    setState(
      response.ok
        ? { people: readHqPeople(response.result), error: null, loaded: true }
        : (previous) => ({ ...previous, error: response.error.message, loaded: true })
    )
  }, [])
  useEffect(() => {
    const run = (): void =>
      void load().catch((error: unknown) =>
        setState((previous) => ({ ...previous, error: String(error), loaded: true }))
      )
    run()
    const timer = setInterval(run, REFRESH_MS)
    return () => clearInterval(timer)
  }, [load])
  return state
}

const matches = (row: HqPeopleRow, query: string): boolean =>
  [row.name, row.orgName, row.jobTitle, row.department]
    .filter((value): value is string => Boolean(value))
    .some((value) => value.toLocaleLowerCase().includes(query))

/** The owner's people, then each department by name; the pulse-only ones without a department last. */
function groupPeople(people: HqPeopleRow[]): { title: string; rows: HqPeopleRow[] }[] {
  const byName = (a: HqPeopleRow, b: HqPeopleRow): number => a.name.localeCompare(b.name)
  const known = people.filter(isHqKnownPerson).sort(byName)
  const departments = new Map<string, HqPeopleRow[]>()
  for (const row of people.filter((entry) => !isHqKnownPerson(entry))) {
    const title = row.department ?? translate('auto.hq.people.other', 'Other')
    departments.set(title, [...(departments.get(title) ?? []), row])
  }
  return [
    ...(known.length > 0
      ? [{ title: translate('auto.hq.people.yours', 'You work with'), rows: known }]
      : []),
    ...[...departments.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([title, rows]) => ({ title, rows: rows.sort(byName) }))
  ]
}

function PersonRow({
  row,
  current,
  onSelect
}: {
  row: HqPeopleRow
  current: boolean
  onSelect: () => void
}): React.JSX.Element {
  const open = row.onMe + row.onThem
  return (
    <button
      type="button"
      aria-current={current ? 'page' : undefined}
      onClick={onSelect}
      className="flex items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none aria-[current=page]:bg-accent"
    >
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-[13px] font-medium">{row.name}</span>
        {row.jobTitle ? (
          <span className="truncate text-[11px] text-muted-foreground">{row.jobTitle}</span>
        ) : null}
      </span>
      {open > 0 ? (
        <span
          className="shrink-0 text-[11px] text-chat-unread tabular-nums"
          title={translate('auto.hq.people.openCount', 'Open between you')}
        >
          {open}
        </span>
      ) : null}
    </button>
  )
}

export function HqPeopleTab(): React.JSX.Element {
  const { people, error, loaded } = useHqPeople()
  const [query, setQuery] = useState('')
  const [chosen, setChosen] = useState<string | null>(null)
  const [listOpen, setListOpen] = useState(true)
  const groups = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase()
    return groupPeople(needle ? people.filter((row) => matches(row, needle)) : people)
  }, [people, query])
  const current =
    people.find((row) => row.key === chosen) ?? groups[0]?.rows[0] ?? people[0] ?? null
  const select = (key: string): void => {
    setChosen(key)
    setListOpen(false)
  }

  if (loaded && people.length === 0) {
    return (
      <p className="p-4 text-sm text-muted-foreground">
        {error ??
          translate(
            'auto.hq.people.empty',
            'No people yet. Put the org matrix in HQ as people/org.csv.'
          )}
      </p>
    )
  }
  return (
    <div className="flex h-full min-h-0">
      <nav
        data-open={listOpen}
        className="flex w-72 shrink-0 flex-col border-r border-border @max-xl/hq:w-full @max-xl/hq:border-r-0 @max-xl/hq:data-[open=false]:hidden"
        aria-label={translate('auto.hq.pinned.people', 'People')}
      >
        <div className="p-3 pb-2">
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={translate('auto.hq.people.search', 'Name, role or department')}
            aria-label={translate('auto.hq.people.searchLabel', 'Search people')}
          />
        </div>
        <div className="scrollbar-sleek flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-3 pb-3">
          {groups.map((group) => (
            <section key={group.title} className="flex flex-col gap-0.5">
              <div className="px-2 py-1">
                <ColumnHeader title={group.title} count={group.rows.length} />
              </div>
              {group.rows.map((row) => (
                <PersonRow
                  key={row.key}
                  row={row}
                  current={row.key === current?.key}
                  onSelect={() => select(row.key)}
                />
              ))}
            </section>
          ))}
        </div>
      </nav>
      <section
        data-open={listOpen}
        className="flex min-w-0 flex-1 flex-col @max-xl/hq:data-[open=true]:hidden"
      >
        {current ? (
          <HqPersonCard
            key={current.key}
            row={current}
            people={people}
            onSelect={select}
            onShowList={() => setListOpen(true)}
          />
        ) : null}
      </section>
    </div>
  )
}

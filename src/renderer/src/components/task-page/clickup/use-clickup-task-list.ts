import { useEffect, useRef, useState } from 'react'
import type {
  ClickUpList,
  ClickUpSpace,
  ClickUpTaskFilter,
  ClickUpTaskSummary
} from '../../../../../shared/clickup-types'
import type { TaskSourceContext } from '../../../../../shared/task-source-context'
import {
  clickUpListLists,
  clickUpListSpaces,
  clickUpListTasks,
  clickUpSearchTasks
} from '@/runtime/runtime-clickup-client'
import { useAppStore } from '@/store'

const FILTER_STORAGE_KEY = 'orca-plus.clickup.task-filter'

function readStoredFilter(): ClickUpTaskFilter {
  try {
    const raw: unknown = JSON.parse(window.localStorage.getItem(FILTER_STORAGE_KEY) ?? 'null')
    if (raw && typeof raw === 'object') {
      const value = Object.fromEntries(Object.entries(raw))
      return {
        scope: value.scope === 'all' ? 'all' : 'mine',
        ...(value.includeDone === true ? { includeDone: true } : {}),
        ...(typeof value.spaceId === 'string' ? { spaceId: value.spaceId } : {}),
        ...(typeof value.listId === 'string' ? { listId: value.listId } : {})
      }
    }
  } catch {
    // Fall back to the default view.
  }
  return { scope: 'mine' }
}

export type ClickUpTaskListState = {
  filter: ClickUpTaskFilter
  setFilter: (next: ClickUpTaskFilter) => void
  searchInput: string
  setSearchInput: (value: string) => void
  applySearch: (value: string) => void
  appliedSearch: string
  tasks: ClickUpTaskSummary[]
  loading: boolean
  error: string | null
  spaces: ClickUpSpace[]
  lists: ClickUpList[]
  refresh: () => void
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : String(error)
}

export function useClickUpTaskList(
  sourceContext: TaskSourceContext | null,
  enabled: boolean
): ClickUpTaskListState {
  const revision = useAppStore((s) => s.clickUpConnectionRevision)
  const [filter, setFilterState] = useState<ClickUpTaskFilter>(readStoredFilter)
  const [searchInput, setSearchInput] = useState('')
  const [appliedSearch, setAppliedSearch] = useState('')
  const [tasks, setTasks] = useState<ClickUpTaskSummary[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [spaces, setSpaces] = useState<ClickUpSpace[]>([])
  const [lists, setLists] = useState<ClickUpList[]>([])
  const [refreshNonce, setRefreshNonce] = useState(0)
  const requestRef = useRef(0)

  const setFilter = (next: ClickUpTaskFilter): void => {
    setFilterState(next)
    try {
      window.localStorage.setItem(FILTER_STORAGE_KEY, JSON.stringify(next))
    } catch {
      // Why: the filter is a convenience; a blocked storage must not break the list.
    }
  }

  useEffect(() => {
    if (!enabled) {
      return
    }
    let cancelled = false
    clickUpListSpaces(sourceContext)
      .then((next) => !cancelled && setSpaces(next))
      .catch(() => !cancelled && setSpaces([]))
    return () => {
      cancelled = true
    }
  }, [enabled, revision, sourceContext])

  const spaceId = filter.spaceId
  useEffect(() => {
    if (!enabled || !spaceId) {
      setLists([])
      return
    }
    let cancelled = false
    clickUpListLists(sourceContext, spaceId)
      .then((next) => !cancelled && setLists(next))
      .catch(() => !cancelled && setLists([]))
    return () => {
      cancelled = true
    }
  }, [enabled, revision, sourceContext, spaceId])

  useEffect(() => {
    if (!enabled) {
      return
    }
    const request = ++requestRef.current
    setLoading(true)
    setError(null)
    const read = appliedSearch
      ? clickUpSearchTasks(sourceContext, appliedSearch, filter)
      : clickUpListTasks(sourceContext, filter)
    read
      .then((next) => {
        if (request === requestRef.current) {
          setTasks(next)
        }
      })
      .catch((reason: unknown) => {
        if (request === requestRef.current) {
          setTasks([])
          setError(errorMessage(reason))
        }
      })
      .finally(() => {
        if (request === requestRef.current) {
          setLoading(false)
        }
      })
  }, [appliedSearch, enabled, filter, refreshNonce, revision, sourceContext])

  return {
    filter,
    setFilter,
    searchInput,
    setSearchInput,
    applySearch: (value) => {
      setSearchInput(value)
      setAppliedSearch(value.trim())
    },
    appliedSearch,
    tasks,
    loading,
    error,
    spaces,
    lists,
    refresh: () => setRefreshNonce((n) => n + 1)
  }
}

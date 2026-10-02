// Custom build (hq): ClickUp for a project's HQ card — the connection as the Tasks page sees it, the
// open tasks of the project's linked list, and the spaces and lists to link one from.
import { useEffect, useMemo, useState } from 'react'
import type {
  ClickUpList,
  ClickUpSpace,
  ClickUpTaskScope,
  ClickUpTaskSummary
} from '../../../../../shared/clickup-types'
import { getSettingsFocusedExecutionHostId } from '../../../../../shared/execution-host'
import type { TaskSourceContext } from '../../../../../shared/task-source-context'
import { buildClickUpTaskSourceContext } from '@/lib/clickup-linked-work-item'
import { readIpcErrorMessage } from '@/lib/ipc-error'
import { getProviderRuntimeContextKey } from '@/lib/provider-runtime-context'
import {
  clickUpListLists,
  clickUpListSpaces,
  clickUpListTasks
} from '@/runtime/runtime-clickup-client'
import { useAppStore } from '@/store'

// Why: the most main reads per request; status chips filter what comes back.
const TASK_LIMIT = 200

export type HqClickUpConnection =
  | { status: 'checking' }
  | { status: 'disconnected'; error: string | null }
  | { status: 'ready'; sourceContext: TaskSourceContext | null; revision: number }

export type HqClickUpTasksState =
  | { status: 'loading' }
  | { status: 'ready'; tasks: ClickUpTaskSummary[] }
  | { status: 'error'; message: string }

function errorText(error: unknown): string {
  return readIpcErrorMessage(error) ?? String(error)
}

export function useHqClickUpConnection(repoId: string): HqClickUpConnection {
  const settings = useAppStore((s) => s.settings)
  const status = useAppStore((s) => s.clickUpStatus)
  const checked = useAppStore((s) => s.clickUpStatusChecked)
  const contextKey = useAppStore((s) => s.clickUpStatusContextKey)
  const revision = useAppStore((s) => s.clickUpConnectionRevision)
  const checkConnection = useAppStore((s) => s.checkClickUpConnection)
  const ready = checked && contextKey === getProviderRuntimeContextKey(settings)
  // Why: only Settings and the Tasks page check the connection; HQ may be the first to need it.
  useEffect(() => {
    if (!ready) {
      void checkConnection()
    }
  }, [checkConnection, ready])
  const workspace =
    status.workspaces.find((entry) => entry.id === status.selectedWorkspaceId) ??
    status.workspaces[0] ??
    null
  const hostId = getSettingsFocusedExecutionHostId(settings)
  const sourceContext = useMemo(
    () => buildClickUpTaskSourceContext({ projectId: repoId, hostId, workspace }),
    [repoId, hostId, workspace]
  )
  if (!ready) {
    return { status: 'checking' }
  }
  return status.connected
    ? { status: 'ready', sourceContext, revision }
    : { status: 'disconnected', error: status.credentialError ?? null }
}

/** Open tasks of one list — mine or everyone's — newest activity first as ClickUp returns them. */
export function useHqClickUpTasks(
  connection: HqClickUpConnection,
  listId: string | null,
  scope: ClickUpTaskScope
): { state: HqClickUpTasksState; refresh: () => void } {
  const [loaded, setLoaded] = useState<{ key: string; state: HqClickUpTasksState } | null>(null)
  const [nonce, setNonce] = useState(0)
  const sourceContext = connection.status === 'ready' ? connection.sourceContext : null
  const revision = connection.status === 'ready' ? connection.revision : -1
  const key = `${listId ?? ''}:${scope}:${revision}:${nonce}`
  useEffect(() => {
    if (!listId || revision < 0) {
      return
    }
    let alive = true
    clickUpListTasks(sourceContext, { scope, listId }, TASK_LIMIT)
      .then((tasks) => {
        if (alive) {
          setLoaded({ key, state: { status: 'ready', tasks } })
        }
      })
      .catch((error: unknown) => {
        if (alive) {
          setLoaded({ key, state: { status: 'error', message: errorText(error) } })
        }
      })
    return () => {
      alive = false
    }
  }, [key, listId, revision, scope, sourceContext])
  return {
    state: loaded?.key === key ? loaded.state : { status: 'loading' },
    refresh: () => setNonce((value) => value + 1)
  }
}

/** The user's own open tasks across the workspace — what the Today tab reads deadlines from. */
export function useHqMyClickUpTasks(connection: HqClickUpConnection): {
  state: HqClickUpTasksState
  refresh: () => void
} {
  const [loaded, setLoaded] = useState<{ key: string; state: HqClickUpTasksState } | null>(null)
  const [nonce, setNonce] = useState(0)
  const sourceContext = connection.status === 'ready' ? connection.sourceContext : null
  const revision = connection.status === 'ready' ? connection.revision : -1
  const key = `${revision}:${nonce}`
  useEffect(() => {
    if (revision < 0) {
      return
    }
    let alive = true
    clickUpListTasks(sourceContext, { scope: 'mine' }, TASK_LIMIT)
      .then((tasks) => {
        if (alive) {
          setLoaded({ key, state: { status: 'ready', tasks } })
        }
      })
      .catch((error: unknown) => {
        if (alive) {
          setLoaded({ key, state: { status: 'error', message: errorText(error) } })
        }
      })
    return () => {
      alive = false
    }
  }, [key, revision, sourceContext])
  return {
    state: loaded?.key === key ? loaded.state : { status: 'loading' },
    refresh: () => setNonce((value) => value + 1)
  }
}

/** Spaces while picking, and the chosen space's lists. */
export function useHqClickUpPicker(
  connection: HqClickUpConnection,
  picking: boolean,
  spaceId: string | null
): { spaces: ClickUpSpace[] | null; lists: ClickUpList[] | null; error: string | null } {
  const [spaces, setSpaces] = useState<ClickUpSpace[] | null>(null)
  const [lists, setLists] = useState<{ spaceId: string; lists: ClickUpList[] } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const sourceContext = connection.status === 'ready' ? connection.sourceContext : null
  const enabled = picking && connection.status === 'ready'
  useEffect(() => {
    if (!enabled) {
      return
    }
    let alive = true
    clickUpListSpaces(sourceContext)
      .then((next) => {
        if (alive) {
          setSpaces(next)
        }
      })
      .catch((reason: unknown) => {
        if (alive) {
          setError(errorText(reason))
        }
      })
    return () => {
      alive = false
    }
  }, [enabled, sourceContext])
  useEffect(() => {
    if (!enabled || !spaceId) {
      return
    }
    let alive = true
    clickUpListLists(sourceContext, spaceId)
      .then((next) => {
        if (alive) {
          setLists({ spaceId, lists: next })
        }
      })
      .catch((reason: unknown) => {
        if (alive) {
          setError(errorText(reason))
        }
      })
    return () => {
      alive = false
    }
  }, [enabled, sourceContext, spaceId])
  return {
    spaces,
    lists: spaceId && lists?.spaceId === spaceId ? lists.lists : null,
    error
  }
}

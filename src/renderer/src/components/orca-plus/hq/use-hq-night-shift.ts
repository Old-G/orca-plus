// Custom build (hq-night-shift): starts the tasks the owner queued «Tonight» once night comes — the
// same Take as the button, with the agent kept inside its worktree. Lives in App, so HQ need not be open.
import { useEffect, useRef } from 'react'
import type { HqAutonomyLevel } from '../../../../../shared/hq-autonomy'
import {
  HQ_NIGHT_SHIFT_DEFAULT_HOUR,
  dueHqNightTasks,
  hqNightTaskChanged
} from '../../../../../shared/hq-night-shift'
import { isGitRepoKind } from '../../../../../shared/repo-kind'
import { clickUpGetTask } from '@/runtime/runtime-clickup-client'
import { useAppStore } from '@/store'
import { patchHqTriageDecision } from './hq-triage-decisions'
import { runHqTake } from './hq-triage-run-take'
import { useHqClickUpConnection } from './use-hq-project-clickup'
import { useHqProjectPages } from './use-hq-project-pages'

const TODAY_SOURCE_PROJECT = 'hq-today'
const CHECK_MS = 5 * 60_000
const DEFAULT_LEVEL: HqAutonomyLevel = 1

export function useHqNightShift(): void {
  const connection = useHqClickUpConnection(TODAY_SOURCE_PROJECT)
  const pages = useHqProjectPages()
  const latest = useRef({ connection, pages })
  latest.current = { connection, pages }

  useEffect(() => {
    let running = false
    const tick = async (): Promise<void> => {
      const { connection: link, pages: loaded } = latest.current
      const state = useAppStore.getState()
      const due = dueHqNightTasks(
        state.settings?.hqTriageDecisions ?? {},
        Date.now(),
        state.settings?.hqNightShiftHour ?? HQ_NIGHT_SHIFT_DEFAULT_HOUR
      )
      if (running || due.length === 0 || link.status !== 'ready') {
        return
      }
      running = true
      const levelOf = (repoId: string): HqAutonomyLevel =>
        (loaded.status === 'ready'
          ? loaded.pages.find((page) => page.repoId === repoId)?.autonomy
          : null) ?? DEFAULT_LEVEL
      try {
        for (const { taskId, repoIds } of due) {
          // Why: one try per night — a launch that fails is not retried every five minutes.
          await patchHqTriageDecision(taskId, { nightTriedAt: Date.now() })
          const task = await clickUpGetTask(link.sourceContext, taskId).catch(() => null)
          if (!task) {
            continue
          }
          // Why: nobody watches at night; a task edited after the owner queued it waits for him.
          const queuedAt = state.settings?.hqTriageDecisions?.[taskId]?.queuedUpdatedAt
          if (hqNightTaskChanged(queuedAt, task.updatedAt)) {
            await patchHqTriageDecision(taskId, { nightSkipped: 'changed' })
            continue
          }
          await runHqTake(task, repoIds, {
            sourceContext: link.sourceContext,
            repos: useAppStore.getState().repos.filter(isGitRepoKind),
            levelOf,
            night: true
          }).catch((error: unknown) => console.warn('[hq-night-shift] take failed:', error))
        }
      } finally {
        running = false
      }
    }
    const timer = setInterval(() => void tick(), CHECK_MS)
    void tick()
    return () => clearInterval(timer)
  }, [])
}

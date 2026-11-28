// Custom build (hq-task-progress, C7 28.11): a chat's work events — a PR opened, merged, shipped —
// add one line to «Ход» of its row's file `runs/<plan>/<row>.md`. The plan file is never written (the
// Lead and Orca+ would edit one file; U1 audit 19). `orca hq task-event <event>` is the way in.

export const HQ_TASK_EVENTS = ['opened', 'merged', 'shipped'] as const
export type HqTaskEvent = (typeof HQ_TASK_EVENTS)[number]

/** One written (or skipped) row file. */
export type HqTaskProgressRow = {
  plan: string
  row: string
  /** `written`: a new line; `duplicate`: the same event and link were already there; `skipped`: the plan or row name is not a safe path. */
  status: 'written' | 'duplicate' | 'skipped'
  line: string
}

export type HqTaskProgressResult =
  | { event: HqTaskEvent; ok: true; rows: HqTaskProgressRow[] }
  | {
      event: HqTaskEvent
      ok: false
      /** `off`: the setting is off; `no-row`: this chat holds no plan row; `no-hq`: no HQ folder. */
      reason: 'off' | 'no-row' | 'no-hq'
    }

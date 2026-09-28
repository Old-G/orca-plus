// Custom build: runs a job once a burst of triggers settles, never two at a time, and once more
// when a trigger lands mid-run — the shape the HQ followers (roster sync, pulse mirror) share.

export type DebouncedSingleFlight<T> = {
  /** A change happened; run once the burst settles. */
  schedule(): void
  /** Run now, or join the running pass and have it read once more. */
  runNow(): Promise<T>
  /** Resolves when nothing is running (tests). */
  idle(): Promise<T | null>
  dispose(): void
}

export function createDebouncedSingleFlight<T>(
  run: () => Promise<T>,
  onError: (error: unknown) => T,
  debounceMs: number
): DebouncedSingleFlight<T> {
  let timer: ReturnType<typeof setTimeout> | null = null
  let running: Promise<T> | null = null
  let rerun = false

  const drain = async (): Promise<T> => {
    let outcome: T
    do {
      rerun = false
      outcome = await run().catch(onError)
    } while (rerun)
    return outcome
  }

  const start = (): Promise<T> => {
    running = drain().finally(() => {
      running = null
    })
    return running
  }

  return {
    schedule(): void {
      if (timer) {
        clearTimeout(timer)
      }
      timer = setTimeout(() => {
        timer = null
        if (running) {
          // Why: the running pass may have read its inputs before this change.
          rerun = true
          return
        }
        void start()
      }, debounceMs)
    },

    runNow(): Promise<T> {
      if (running) {
        rerun = true
        return running
      }
      return start()
    },

    async idle(): Promise<T | null> {
      return running ? running : null
    },

    dispose(): void {
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
    }
  }
}

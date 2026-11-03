// Custom build (hq-fix-now-all, owner 03.11: «Fix now» held its card 82 s while seven chats opened one
// by one): a routing pass starts each project's chat on its own, a few at a time so the Mac keeps up,
// and one launch that hangs gives a result after a while instead of holding the card forever.

/** `run` on every item, at most `limit` at once; results keep the items' order. */
export async function mapAtMost<T, R>(
  items: readonly T[],
  limit: number,
  run: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = Array.from({ length: items.length })
  let next = 0
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const index = next++
      results[index] = await run(items[index] as T)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}

/** `work`'s result, or `late()` once `ms` pass first; the work itself goes on. */
export function orAfter<R>(work: Promise<R>, ms: number, late: () => R): Promise<R> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<R>((resolve) => {
    timer = setTimeout(() => resolve(late()), ms)
  })
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer))
}

/** Launches that answered late and still run, by project. Why: a launch past its timeout goes on and
 *  records its chat later; the next pass must not start that project again, or it opens a second chat
 *  for the same findings (Codex P1, 04.11) — while every other project goes ahead (a hung launch must
 *  not hold all routing). */
export function createLateWork(): {
  orAfter: <R>(key: string, work: Promise<R>, ms: number, late: () => R) => Promise<R>
  busy: (key: string) => boolean
} {
  const pending = new Map<string, Promise<unknown>>()
  return {
    orAfter: (key, work, ms, late) =>
      orAfter(work, ms, () => {
        const tracked = work.then(
          () => undefined,
          () => undefined
        )
        pending.set(key, tracked)
        void tracked.then(() => {
          if (pending.get(key) === tracked) {
            pending.delete(key)
          }
        })
        return late()
      }),
    busy: (key) => pending.has(key)
  }
}

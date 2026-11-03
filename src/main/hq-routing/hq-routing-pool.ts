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

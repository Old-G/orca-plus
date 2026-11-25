// A file's text kept briefly after a read, so `drive read --offset` pages through the same text
// instead of fetching and converting the whole file again for every page.
const TTL_MS = 5 * 60_000
const MAX_FILES = 8

type Entry = { text: string; source: string; at: number }
const entries = new Map<string, Entry>()
// Custom build (google-disconnect-forget): bumped by each forget, so a read still converting when an
// account was disconnected does not put its text back. Any account's read skips the cache then.
let forgets = 0

/** The text for this version of the file, made once and reused for a few minutes. */
export async function cachedFileText(
  key: { account: string; id: string; modifiedTime?: string },
  make: () => Promise<{ text: string; source: string }>,
  now = Date.now()
): Promise<{ text: string; source: string }> {
  // No modified time means no way to tell versions apart, so nothing is kept.
  if (!key.modifiedTime) {
    return make()
  }
  const name = `${key.account}\n${key.id}\n${key.modifiedTime}`
  const hit = entries.get(name)
  if (hit && now - hit.at < TTL_MS) {
    return hit
  }
  const forgetsBefore = forgets
  const made = { ...(await make()), at: now }
  if (forgets !== forgetsBefore) {
    return made
  }
  entries.delete(name)
  entries.set(name, made)
  for (const [old, entry] of entries) {
    if (entries.size <= MAX_FILES && now - entry.at < TTL_MS) {
      break
    }
    entries.delete(old)
  }
  return made
}

// Custom build (google-disconnect-forget): a disconnected account's text goes at once, not when it ages out.
/** Drops every file text kept for this account. */
export function forgetCachedFileText(account: string): void {
  forgets += 1
  const prefix = `${account.toLowerCase()}\n`
  for (const name of entries.keys()) {
    if (name.toLowerCase().startsWith(prefix)) {
      entries.delete(name)
    }
  }
}

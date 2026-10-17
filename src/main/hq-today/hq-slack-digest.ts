// Custom build (hq-scout-digest): at the digest hours, one bell item sums up Slack — the requests still
// waiting for the owner and what the scout set aside as quiet since the last digest. The newest digest
// replaces the previous one; a missed hour (Mac asleep, Orca+ closed) is caught up once.
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  HQ_SLACK_DIGEST_KIND,
  HQ_SLACK_QUIET_FILE,
  hqDigestSlot,
  hqSlackDigestItem,
  parseHqSlackQuiet
} from '../../shared/hq-slack-digest'
import {
  HQ_SLACK_SCOUT_CONFIG_FILE,
  HQ_SLACK_SCOUT_DIR,
  parseHqSlackScoutTuning,
  type HqSlackScoutResult
} from '../../shared/hq-slack-scout'
import type { PulseBellInput } from '../../shared/pulse-bell'

const STATE_FILE = 'digest-state.json'
const CHECK_MS = 60_000

export type HqSlackDigestDeps = {
  hqPath: () => string | null
  enabled: () => boolean
  readScout: (hqPath: string) => Promise<HqSlackScoutResult>
  sync: (kind: string, items: readonly PulseBellInput[]) => void
  now: () => Date
}

type DigestState = { slot: string | null; at: string | null }

async function readText(path: string): Promise<string | null> {
  return readFile(path, 'utf8').catch(() => null)
}

function readState(text: string | null): DigestState | null {
  if (!text) {
    return null
  }
  try {
    const raw: unknown = JSON.parse(text)
    const slot = raw && typeof raw === 'object' ? Reflect.get(raw, 'slot') : null
    const at = raw && typeof raw === 'object' ? Reflect.get(raw, 'at') : null
    return {
      slot: typeof slot === 'string' ? slot : null,
      at: typeof at === 'string' ? at : null
    }
  } catch {
    return null
  }
}

/** Posts the digest when a new hour slot was reached; returns true when one was posted. */
export async function runHqSlackDigest(deps: HqSlackDigestDeps): Promise<boolean> {
  const hq = deps.hqPath()
  if (!hq || !deps.enabled()) {
    return false
  }
  const dir = join(hq, HQ_SLACK_SCOUT_DIR)
  const [configText, stateText, quietText] = await Promise.all([
    readText(join(dir, HQ_SLACK_SCOUT_CONFIG_FILE)),
    readText(join(dir, STATE_FILE)),
    readText(join(dir, HQ_SLACK_QUIET_FILE))
  ])
  const now = deps.now()
  const slot = hqDigestSlot(now, parseHqSlackScoutTuning(configText ?? '').digestHours)
  const state = readState(stateText)
  if (!slot || state?.slot === slot) {
    return false
  }
  const save = async (): Promise<void> => {
    await mkdir(dir, { recursive: true })
    const path = join(dir, STATE_FILE)
    const temp = `${path}.${process.pid}.tmp`
    await writeFile(temp, `${JSON.stringify({ slot, at: now.toISOString() })}\n`)
    await rename(temp, path)
  }
  // Why: the first run only marks where it starts, so a fresh install does not post a stale digest.
  if (!state) {
    await save()
    return false
  }
  const scout = await deps.readScout(hq)
  if (!scout.ok) {
    return false
  }
  const since = Date.parse(state.at ?? '') || 0
  const quiet = parseHqSlackQuiet(quietText ?? '{}').filter((item) => Date.parse(item.at) > since)
  const item = hqSlackDigestItem(slot, scout.drafts, quiet)
  if (item) {
    deps.sync(HQ_SLACK_DIGEST_KIND, [item])
  }
  await save()
  return item !== null
}

export function startHqSlackDigest(deps: HqSlackDigestDeps): () => void {
  let running = false
  const check = (): void => {
    if (running) {
      return
    }
    running = true
    runHqSlackDigest(deps)
      .catch((error: unknown) => console.warn('[hq-slack-digest] failed:', error))
      .finally(() => {
        running = false
      })
  }
  check()
  const timer = setInterval(check, CHECK_MS)
  timer.unref?.()
  return () => clearInterval(timer)
}

// Custom build (slack-notifications): which Slack thread holds each workspace's updates, and
// (slack-socket) which agent pane last spoke in it, so a reply there reaches that agent.
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { writeCredentialFileAtomic } from '../integration-credential-file'
import { getProfileUserDataPath } from '../orca-profiles/profile-storage-paths'
import { asSlackRecord } from './slack-request'

export type SlackThreadPane = { paneKey: string; surface: 'terminal' | 'agent-session' }

type ThreadEntry = { ts: string; updatedAt: number; pane?: SlackThreadPane }

export type SlackThreadMatch = { worktreeId: string; pane: SlackThreadPane | null }

// Why: bounded so years of throwaway worktrees cannot grow the file without limit.
const MAX_THREADS_PER_CHANNEL = 500

export type SlackThreadStore = {
  get: (channelId: string, worktreeId: string) => string | null
  set: (channelId: string, worktreeId: string, ts: string) => void
  forget: (channelId: string, worktreeId: string) => void
  setPane: (channelId: string, worktreeId: string, pane: SlackThreadPane) => void
  findByTs: (channelId: string, ts: string) => SlackThreadMatch | null
}

function getThreadsPath(): string {
  return join(getProfileUserDataPath(), 'slack', 'threads.json')
}

function readPane(value: unknown): SlackThreadPane | undefined {
  const raw = asSlackRecord(value)
  if (typeof raw.paneKey !== 'string') {
    return undefined
  }
  return {
    paneKey: raw.paneKey,
    surface: raw.surface === 'agent-session' ? 'agent-session' : 'terminal'
  }
}

function readThreads(path: string): Map<string, Map<string, ThreadEntry>> {
  const channels = new Map<string, Map<string, ThreadEntry>>()
  if (!existsSync(path)) {
    return channels
  }
  try {
    const raw = asSlackRecord(JSON.parse(readFileSync(path, 'utf-8')))
    for (const [channelId, value] of Object.entries(asSlackRecord(raw.channels))) {
      const threads = new Map<string, ThreadEntry>()
      for (const [worktreeId, entry] of Object.entries(asSlackRecord(value))) {
        const record = asSlackRecord(entry)
        if (typeof record.ts === 'string' && typeof record.updatedAt === 'number') {
          const pane = readPane(record.pane)
          threads.set(worktreeId, {
            ts: record.ts,
            updatedAt: record.updatedAt,
            ...(pane ? { pane } : {})
          })
        }
      }
      channels.set(channelId, threads)
    }
  } catch {
    // A corrupt file only costs new threads.
  }
  return channels
}

export function createSlackThreadStore(
  readPath: () => string = getThreadsPath,
  now: () => number = Date.now
): SlackThreadStore {
  let channels: Map<string, Map<string, ThreadEntry>> | null = null
  const load = (): Map<string, Map<string, ThreadEntry>> => {
    channels ??= readThreads(readPath())
    return channels
  }
  const persist = (): void => {
    const data: Record<string, Record<string, ThreadEntry>> = {}
    for (const [channelId, threads] of load()) {
      data[channelId] = Object.fromEntries(threads)
    }
    const path = readPath()
    mkdirSync(dirname(path), { recursive: true })
    writeCredentialFileAtomic(path, Buffer.from(JSON.stringify({ version: 1, channels: data })))
  }
  const upsert = (channelId: string, worktreeId: string, entry: ThreadEntry): void => {
    const all = load()
    const threads = all.get(channelId) ?? new Map<string, ThreadEntry>()
    threads.delete(worktreeId)
    threads.set(worktreeId, entry)
    while (threads.size > MAX_THREADS_PER_CHANNEL) {
      const oldest = threads.keys().next().value
      if (oldest === undefined) {
        break
      }
      threads.delete(oldest)
    }
    all.set(channelId, threads)
    persist()
  }
  return {
    get: (channelId, worktreeId) => load().get(channelId)?.get(worktreeId)?.ts ?? null,
    set: (channelId, worktreeId, ts) => upsert(channelId, worktreeId, { ts, updatedAt: now() }),
    forget: (channelId, worktreeId) => {
      if (load().get(channelId)?.delete(worktreeId)) {
        persist()
      }
    },
    setPane: (channelId, worktreeId, pane) => {
      const entry = load().get(channelId)?.get(worktreeId)
      if (!entry) {
        return
      }
      const same = entry.pane?.paneKey === pane.paneKey && entry.pane.surface === pane.surface
      if (!same) {
        upsert(channelId, worktreeId, { ...entry, pane, updatedAt: now() })
      }
    },
    findByTs: (channelId, ts) => {
      for (const [worktreeId, entry] of load().get(channelId) ?? []) {
        if (entry.ts === ts) {
          return { worktreeId, pane: entry.pane ?? null }
        }
      }
      return null
    }
  }
}

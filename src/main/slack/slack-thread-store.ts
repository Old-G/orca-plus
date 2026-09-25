// Custom build (slack-notifications): which Slack thread holds each workspace's updates.
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { writeCredentialFileAtomic } from '../integration-credential-file'
import { getProfileUserDataPath } from '../orca-profiles/profile-storage-paths'
import { asSlackRecord } from './slack-request'

type ThreadEntry = { ts: string; updatedAt: number }

// Why: bounded so years of throwaway worktrees cannot grow the file without limit.
const MAX_THREADS_PER_CHANNEL = 500

export type SlackThreadStore = {
  get: (channelId: string, worktreeId: string) => string | null
  set: (channelId: string, worktreeId: string, ts: string) => void
  forget: (channelId: string, worktreeId: string) => void
}

function getThreadsPath(): string {
  return join(getProfileUserDataPath(), 'slack', 'threads.json')
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
          threads.set(worktreeId, { ts: record.ts, updatedAt: record.updatedAt })
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
  return {
    get: (channelId, worktreeId) => load().get(channelId)?.get(worktreeId)?.ts ?? null,
    set: (channelId, worktreeId, ts) => {
      const all = load()
      const threads = all.get(channelId) ?? new Map<string, ThreadEntry>()
      threads.delete(worktreeId)
      threads.set(worktreeId, { ts, updatedAt: now() })
      while (threads.size > MAX_THREADS_PER_CHANNEL) {
        const oldest = threads.keys().next().value
        if (oldest === undefined) {
          break
        }
        threads.delete(oldest)
      }
      all.set(channelId, threads)
      persist()
    },
    forget: (channelId, worktreeId) => {
      if (load().get(channelId)?.delete(worktreeId)) {
        persist()
      }
    }
  }
}

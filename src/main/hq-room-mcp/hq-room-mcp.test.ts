import { describe, expect, it, vi } from 'vitest'
import type { HqSpace } from '../../shared/hq-spaces'
import type { HqCallerScope } from '../hq-journal/hq-journal-rooms'
import { hqRoomDeniedTools } from './hq-room-mcp'

const CHAT = { sessionId: 'chat-1', cwd: '/work/acme' }

function acme(mcpDeny?: string[]): HqSpace {
  return {
    slug: 'acme',
    name: 'Acme',
    color: '#22c55e',
    repoIds: [],
    projects: [],
    ...(mcpDeny ? { mcpDeny } : {})
  }
}

function serviceWith(scope: HqCallerScope, space: HqSpace | null) {
  return { space: vi.fn(async () => ({ scope, space })) }
}

const IN_ACME: HqCallerScope = {
  kind: 'room',
  room: 'acme',
  project: 'acme-crm',
  sessionId: 'chat-1',
  worktreeId: null
}

describe('hqRoomDeniedTools', () => {
  it("hides the chat's room's servers", async () => {
    const service = serviceWith(IN_ACME, acme(['kite', 'claude.ai Kite*']))
    expect(await hqRoomDeniedTools(service, CHAT, () => {})).toEqual([
      'mcp__kite',
      'mcp__claude_ai_Kite*'
    ])
    expect(service.space).toHaveBeenCalledWith(CHAT)
  })

  it('keeps every server for HQ+, a room without a list, no room, or a failed read', async () => {
    const overview: HqCallerScope = { kind: 'overview', sessionId: 'chat-1', worktreeId: null }
    expect(await hqRoomDeniedTools(serviceWith(overview, null), CHAT, () => {})).toEqual([])
    expect(await hqRoomDeniedTools(serviceWith(IN_ACME, acme()), CHAT, () => {})).toEqual([])
    expect(await hqRoomDeniedTools(serviceWith(IN_ACME, null), CHAT, () => {})).toEqual([])
    expect(await hqRoomDeniedTools(null, CHAT, () => {})).toEqual([])
    const broken = {
      space: vi.fn(async (): Promise<{ scope: HqCallerScope; space: HqSpace | null }> => {
        throw new Error('workspace.yaml unreadable')
      })
    }
    const log = vi.fn()
    expect(await hqRoomDeniedTools(broken, CHAT, log)).toEqual([])
    expect(log).toHaveBeenCalledWith(expect.stringContaining('all servers kept'))
  })
})

// Why: locks the /statusline/claude loopback contract — form-encoded posts from the
// managed statusline script must reach the listener, and junk must fail open (204).
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AgentHookServer } from './server'
import type { ClaudeStatusLineRateLimits } from '../../shared/claude-statusline-rate-limits'
import { GOOD_PANE, PANE } from './server.test-fixtures'
import { parsePaneKey } from '../../shared/stable-pane-id'

describe('AgentHookServer /statusline/claude', () => {
  let server: AgentHookServer

  beforeEach(async () => {
    server = new AgentHookServer()
    await server.start({ env: 'production' })
  })

  afterEach(() => {
    server.stop()
  })

  function post(body: string, token?: string): Promise<Response> {
    const env = server.buildPtyEnv()
    return fetch(`http://127.0.0.1:${env.ORCA_AGENT_HOOK_PORT}/statusline/claude`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'X-Orca-Agent-Hook-Token': token ?? env.ORCA_AGENT_HOOK_TOKEN
      },
      body
    })
  }

  it('forwards parsed rate limits to the statusline listener', async () => {
    const events: ClaudeStatusLineRateLimits[] = []
    server.setClaudeStatusLineListener((event) => {
      events.push(event)
    })

    const payload = JSON.stringify({
      rate_limits: {
        five_hour: { used_percentage: 12.5, resets_at: 1738425600 },
        seven_day: { used_percentage: 40, resets_at: 1712059200 }
      }
    })
    const body = new URLSearchParams({
      paneKey: 'pane-1',
      configDir: '/home/dev/managed',
      payload
    }).toString()

    await expect(post(body)).resolves.toMatchObject({ status: 204 })
    expect(events).toEqual([
      {
        configDir: '/home/dev/managed',
        fiveHour: { used_percentage: 12.5, resets_at: 1738425600 },
        sevenDay: { used_percentage: 40, resets_at: 1712059200 }
      }
    ])
  })

  it('rejects posts with a bad token and ignores payloads without rate limits', async () => {
    const events: ClaudeStatusLineRateLimits[] = []
    server.setClaudeStatusLineListener((event) => {
      events.push(event)
    })

    await expect(post('payload={}', 'wrong-token')).resolves.toMatchObject({ status: 403 })

    const noLimits = new URLSearchParams({
      paneKey: 'pane-1',
      payload: JSON.stringify({ context_window: { used_percentage: 8 } })
    }).toString()
    await expect(post(noLimits)).resolves.toMatchObject({ status: 204 })

    await expect(post('payload=not-json')).resolves.toMatchObject({ status: 204 })

    expect(events).toEqual([])
  })

  describe('context window', () => {
    function contextBody(paneKey: string, usedPercentage: number): string {
      return new URLSearchParams({
        paneKey,
        payload: JSON.stringify({
          context_window: { used_percentage: usedPercentage, context_window_size: 1_000_000 }
        })
      }).toString()
    }

    function ingestRow(paneKey: string, agentType: 'claude' | 'codex'): void {
      const tabId = parsePaneKey(paneKey)?.tabId
      server.ingestRemote(
        { paneKey, tabId, worktreeId: 'wt-1', payload: { state: 'working', agentType } },
        'conn-1'
      )
    }

    it('attaches the latest reported context window to the pane row', async () => {
      ingestRow(PANE, 'claude')
      await post(contextBody(PANE, 12))
      await post(contextBody(PANE, 71.5))

      const [row] = server.getStatusSnapshot()
      expect(row?.claudeContextWindow).toEqual({
        usedPercentage: 71.5,
        windowTokens: 1_000_000,
        observedAt: expect.any(Number)
      })
      expect(server.getStatusSnapshotForPane(PANE)[0]?.claudeContextWindow?.usedPercentage).toBe(
        71.5
      )
    })

    it('keeps a report that arrives before the row, and drops it with the pane', async () => {
      await post(contextBody(PANE, 30))
      ingestRow(PANE, 'claude')
      expect(server.getStatusSnapshot()[0]?.claudeContextWindow?.usedPercentage).toBe(30)

      server.clearPaneState(PANE)
      ingestRow(PANE, 'claude')
      const rows = server.getStatusSnapshot()
      expect(rows).toHaveLength(1)
      expect(rows[0]?.claudeContextWindow).toBeUndefined()
    })

    it('never decorates a non-Claude row or another pane', async () => {
      ingestRow(PANE, 'codex')
      ingestRow(GOOD_PANE, 'claude')
      await post(contextBody(PANE, 40))

      const rows = server.getStatusSnapshot()
      expect(rows).toHaveLength(2)
      for (const row of rows) {
        expect(row.claudeContextWindow).toBeUndefined()
      }
    })

    it('ignores posts whose pane key is not a stable pane key', async () => {
      ingestRow(PANE, 'claude')
      await expect(post(contextBody('pane-1', 50))).resolves.toMatchObject({ status: 204 })
      const rows = server.getStatusSnapshot()
      expect(rows).toHaveLength(1)
      expect(rows[0]?.claudeContextWindow).toBeUndefined()
    })
  })
})

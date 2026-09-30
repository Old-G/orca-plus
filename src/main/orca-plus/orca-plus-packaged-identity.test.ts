import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  applyOrcaPlusPackagedProfile,
  dropInheritedAgentSessionEnv
} from './orca-plus-packaged-identity'

describe('applyOrcaPlusPackagedProfile', () => {
  it('moves userData next to, not onto, the stock Orca profile and exports it', () => {
    const setPath = vi.fn()
    const env: NodeJS.ProcessEnv = {
      ORCA_USER_DATA_PATH: '/Users/me/Library/Application Support/orca'
    }
    const dir = applyOrcaPlusPackagedProfile(
      { getPath: () => '/Users/me/Library/Application Support', setPath },
      env
    )
    expect(dir).toBe(join('/Users/me/Library/Application Support', 'orca-plus'))
    expect(setPath).toHaveBeenCalledWith('userData', dir)
    expect(env.ORCA_USER_DATA_PATH).toBe(dir)
  })
})

describe('dropInheritedAgentSessionEnv', () => {
  it("drops a launching agent session's account home and identity", () => {
    const env: NodeJS.ProcessEnv = {
      ORCA_AGENT_SESSION_ID: 'claude_1',
      ORCA_STRUCTURED_SESSION: '1',
      CLAUDE_CONFIG_DIR: '/Users/me/.claude-work',
      HOME: '/Users/me'
    }
    expect(dropInheritedAgentSessionEnv(env).sort()).toEqual([
      'CLAUDE_CONFIG_DIR',
      'ORCA_AGENT_SESSION_ID',
      'ORCA_STRUCTURED_SESSION'
    ])
    expect(env).toEqual({ HOME: '/Users/me' })
  })

  it('keeps a CLAUDE_CONFIG_DIR the user set outside any agent session', () => {
    const env: NodeJS.ProcessEnv = { CLAUDE_CONFIG_DIR: '/Users/me/.claude-own' }
    expect(dropInheritedAgentSessionEnv(env)).toEqual([])
    expect(env.CLAUDE_CONFIG_DIR).toBe('/Users/me/.claude-own')
  })
})

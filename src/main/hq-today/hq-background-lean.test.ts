import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getDefaultSettings } from '../../shared/orca-profiles/constants'
import { planCommitMessageGeneration } from '../../shared/source-control/ai/generation/commit-message-plan'
import { HQ_LEAN_ARGS, HQ_LEAN_SYSTEM_PROMPT } from './hq-background-lean'

const runGenerationRequest = vi.hoisted(() => vi.fn())
vi.mock('../text-generation/agent-generation-request', () => ({ runGenerationRequest }))
vi.mock('../agent-hooks/first-work/first-work-generation-target', () => ({
  resolveGenerationTarget: vi.fn(async () => ({ kind: 'local', cwd: '/hq' }))
}))

const { generateHqText, hqTaskQuestionsParams } = await import('./hq-task-questions')

function plannedArgs(agentArgs: string): string[] {
  const planned = planCommitMessageGeneration(
    { agentId: 'claude', model: 'haiku', thinkingLevel: 'low', agentArgs },
    'q'
  )
  if (!planned.ok) {
    throw new Error(planned.error)
  }
  return planned.plan.args
}

const deps = {
  settings: getDefaultSettings('/home/me'),
  cwd: '/hq',
  getAgentEnvResolvers: () => undefined
}

describe('HQ lean background launch', () => {
  beforeEach(() => runGenerationRequest.mockReset())

  it('starts Claude lean: no browser tools, skills, auto-memory or default system prompt', () => {
    const toolFree = hqTaskQuestionsParams(deps.settings).agentArgs ?? ''
    const args = plannedArgs(`${toolFree} ${HQ_LEAN_ARGS}`)
    expect(args).toEqual(expect.arrayContaining(['-p', '--no-chrome', '--disable-slash-commands']))
    expect(args[args.indexOf('--system-prompt') + 1]).toBe(HQ_LEAN_SYSTEM_PROMPT)
    // One --settings only: ours keeps hooks off, so the default background one is not added.
    expect(args.filter((arg) => arg === '--settings')).toHaveLength(1)
    expect(JSON.parse(args[args.indexOf('--settings') + 1])).toEqual({
      disableAllHooks: true,
      autoMemoryEnabled: false
    })
    // Still tool-less and without MCP servers.
    expect(args[args.lastIndexOf('--tools') + 1]).toBe('')
    expect(args).toContain('--strict-mcp-config')
    expect(args[args.indexOf('--effort') + 1]).toBe('low')
  })

  it('runs a classifier lean and a text people read with the full launch', async () => {
    runGenerationRequest.mockResolvedValue({ success: true, rawOutput: ' {"answer": true} ' })
    const verdict = await generateHqText(
      'q',
      { emptyResultName: 'reply check', operation: 'hq-slack-intake', model: 'haiku' },
      deps
    )
    expect(verdict).toEqual({ ok: true, text: '{"answer": true}' })
    expect(runGenerationRequest.mock.calls[0][0].params.agentArgs).toContain(HQ_LEAN_ARGS)
    expect(runGenerationRequest.mock.calls[0][0].params.model).toBe('haiku')
  })

  it.each([
    'hq-ledger-draft',
    'hq-feed-posts',
    'hq-task-questions',
    'hq-clickup-reply',
    'hq-voice-rewrite',
    // Its answer carries the reply the owner posts in the task.
    'hq-clickup-triage'
  ] as const)('keeps the full launch for %s, whose answer people read', async (operation) => {
    runGenerationRequest.mockResolvedValue({ success: true, rawOutput: 'text' })
    await generateHqText('q', { emptyResultName: 'text', operation }, deps)
    expect(runGenerationRequest.mock.calls[0][0].params.agentArgs).not.toContain('--system-prompt')
  })

  it('asks once more with the full launch when Claude refuses the lean one', async () => {
    runGenerationRequest
      .mockResolvedValueOnce({
        success: false,
        error: 'failed',
        failureOutput: {
          label: 'Claude',
          exitCode: 1,
          stdout: '',
          stderr: "error: unknown option '--no-chrome'"
        }
      })
      .mockResolvedValueOnce({ success: true, rawOutput: 'CHAT' })
    const verdict = await generateHqText(
      'q',
      { emptyResultName: 'reply verdict', operation: 'hq-reply-routing', model: 'haiku' },
      deps
    )
    expect(verdict).toEqual({ ok: true, text: 'CHAT' })
    expect(runGenerationRequest).toHaveBeenCalledTimes(2)
    expect(runGenerationRequest.mock.calls[1][0].params.agentArgs).not.toContain('--no-chrome')
  })

  it.each([
    ['a stopped run', { exitCode: null, stderr: '' }],
    ['a limit or sign-in failure', { exitCode: 1, stderr: 'Claude usage limit reached' }]
  ])('does not ask again after %s', async (_name, exit) => {
    runGenerationRequest.mockResolvedValue({
      success: false,
      error: 'failed',
      failureOutput: { label: 'Claude', stdout: '', ...exit }
    })
    const verdict = await generateHqText(
      'q',
      { emptyResultName: 'MR repo', operation: 'hq-mr-watch', model: 'haiku' },
      deps
    )
    expect(verdict.ok).toBe(false)
    expect(runGenerationRequest).toHaveBeenCalledTimes(1)
  })

  it('does not ask again when the run never started', async () => {
    runGenerationRequest.mockResolvedValue({ success: false, error: 'Could not start Claude' })
    await generateHqText(
      'q',
      { emptyResultName: 'in-work check', operation: 'hq-in-work', model: 'haiku' },
      deps
    )
    expect(runGenerationRequest).toHaveBeenCalledTimes(1)
  })
})

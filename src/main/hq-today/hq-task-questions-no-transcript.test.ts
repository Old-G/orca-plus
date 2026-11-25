// Custom build (google-disconnect-forget)
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getDefaultSettings } from '../../shared/orca-profiles/constants'
import { planCommitMessageGeneration } from '../../shared/source-control/ai/generation/commit-message-plan'

const runs = vi.hoisted(() => ({
  args: [] as (string | undefined)[],
  answers: [] as { success: boolean; [key: string]: unknown }[]
}))

vi.mock('../agent-hooks/first-work/first-work-generation-target', () => ({
  resolveGenerationTarget: async () => ({ kind: 'local' })
}))
vi.mock('../text-generation/agent-generation-request', () => ({
  runGenerationRequest: async (input: { params: { agentArgs?: string } }) => {
    runs.args.push(input.params.agentArgs)
    return runs.answers.shift() ?? { success: true, rawOutput: 'ok' }
  }
}))

const { generateHqText } = await import('./hq-task-questions')

const deps = {
  settings: getDefaultSettings('/Users/me'),
  cwd: '/Users/me/hq',
  getAgentEnvResolvers: () => undefined
}

beforeEach(() => {
  runs.args = []
  runs.answers = []
})

describe('an HQ run on Google user data', () => {
  it('leaves no transcript, and other runs keep theirs', async () => {
    await generateHqText(
      'q',
      { emptyResultName: 'guess', operation: 'hq-ledger-guess', noTranscript: true },
      deps
    )
    await generateHqText('q', { emptyResultName: 'guess', operation: 'hq-ledger-guess' }, deps)
    expect(runs.args[0]).toContain('--no-session-persistence')
    expect(runs.args[1]).not.toContain('--no-session-persistence')

    const planned = planCommitMessageGeneration(
      { agentId: 'claude', model: 'haiku', agentArgs: runs.args[0] },
      'q'
    )
    if (!planned.ok) {
      throw new Error(planned.error)
    }
    expect(planned.plan.args).toContain('--no-session-persistence')
  })

  it('keeps it off on a lean run and on the full retry after a lean refusal', async () => {
    runs.answers = [
      {
        success: false,
        error: 'refused',
        failureOutput: { exitCode: 1, stderr: "error: unknown option '--no-chrome'", stdout: '' }
      }
    ]
    const result = await generateHqText(
      'q',
      { emptyResultName: 'gist', operation: 'hq-slack-intake', noTranscript: true },
      deps
    )
    expect(result).toEqual({ ok: true, text: 'ok' })
    expect(runs.args).toHaveLength(2)
    expect(runs.args[0]).toContain('--no-chrome')
    expect(runs.args.every((args) => args?.includes('--no-session-persistence'))).toBe(true)
  })
})

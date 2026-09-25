import { describe, expect, it } from 'vitest'
import { markdownToSlackMrkdwn, splitSlackMrkdwn } from './slack-mrkdwn'
import { buildSlackAgentUpdate, slackUpdateKind } from './slack-agent-message'
import type { NotificationDispatchRequest } from '../../shared/notification-settings-types'

describe('markdownToSlackMrkdwn', () => {
  it('rewrites emphasis, links, headings and bullets, and escapes Slack control characters', () => {
    const input = [
      '## Result',
      'Fixed **the bug** in *parser* & <main>, see [PR](https://example.com/pr?a=1).',
      '- one',
      '~~old~~'
    ].join('\n')
    expect(markdownToSlackMrkdwn(input)).toBe(
      [
        '*Result*',
        'Fixed *the bug* in _parser_ &amp; &lt;main&gt;, see <https://example.com/pr?a=1|PR>.',
        '• one',
        '~old~'
      ].join('\n')
    )
  })

  it('leaves code untouched and drops the fence language', () => {
    const input = 'Run `a **b**`\n```ts\nconst x = **y**\n```'
    expect(markdownToSlackMrkdwn(input)).toBe('Run `a **b**`\n```\nconst x = **y**\n```')
  })
})

describe('splitSlackMrkdwn', () => {
  it('keeps every chunk within the limit and re-opens a fence it cuts', () => {
    const code = Array.from({ length: 30 }, (_, i) => `line ${i} ${'x'.repeat(20)}`).join('\n')
    const chunks = splitSlackMrkdwn(`intro\n\`\`\`\n${code}\n\`\`\`\noutro`, 300)
    expect(chunks.length).toBeGreaterThan(2)
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(300)
      expect((chunk.match(/```/g) ?? []).length % 2).toBe(0)
    }
    expect(chunks.join('\n')).toContain('outro')
  })
})

describe('slack agent update', () => {
  const base: NotificationDispatchRequest = { source: 'agent-task-complete', worktreeId: 'wt' }

  it('never announces a working agent and names waits and cancels', () => {
    expect(slackUpdateKind({ ...base, agentState: 'working' })).toBeNull()
    expect(slackUpdateKind({ ...base, agentState: 'blocked' })).toBe('needs-input')
    expect(slackUpdateKind({ ...base, agentState: 'waiting' })).toBe('needs-input')
    expect(slackUpdateKind({ ...base, agentState: 'done', agentInterrupted: true })).toBe('stopped')
    expect(slackUpdateKind({ ...base, agentState: 'done' })).toBe('finished')
    expect(slackUpdateKind(base)).toBe('finished')
  })

  it('carries the prompt, the full reply, the awaited tool and the git summary', () => {
    const message = buildSlackAgentUpdate({
      kind: 'needs-input',
      agentLabel: 'Claude',
      title: 'orca / fix-login',
      request: {
        ...base,
        agentPrompt: 'Fix the login flow',
        agentLastAssistantMessage: 'I need to run **migrations**.',
        agentToolName: 'Bash',
        agentToolInput: 'pnpm db:migrate'
      },
      git: { branch: 'fix-login', files: 2, added: 10, removed: 3, ahead: 1 }
    })
    expect(message.text).toBe('Claude needs your input · orca / fix-login')
    const texts = JSON.stringify(message.blocks)
    expect(texts).toContain('Fix the login flow')
    expect(texts).toContain('I need to run *migrations*.')
    expect(texts).toContain('Waiting on `Bash`: `pnpm db:migrate`')
    expect(texts).toContain('2 files changed +10 −3 · 1 commit not pushed')
  })
})

import { describe, expect, it } from 'vitest'
import { claudeHandoffRelativePath, parseClaudeHandoffFile } from './claude-handoff-file'

const SESSION = '03f7347c-56f8-45a2-a9fd-53d4c8eda991'

function handoff(overrides: { frontmatter?: string; prompt?: string } = {}): string {
  return [
    '---',
    overrides.frontmatter ??
      [
        'type: strata-handoff',
        `session: ${SESSION}`,
        'created: 2026-09-27T11:44:15+03:00',
        'workspace: /work/orca',
        'branch: custom',
        'head: f54a8d79001',
        'pushed: no'
      ].join('\n'),
    '---',
    '## Goal',
    'Finish 1.4.4.',
    '',
    '## How to verify',
    '```bash',
    'git status -sb',
    '```',
    '',
    '## Prompt',
    overrides.prompt ??
      ['```text', 'Continue Orca+ «Штаб».', '', '## not a heading inside the fence', '```'].join(
        '\n'
      ),
    ''
  ].join('\n')
}

describe('parseClaudeHandoffFile', () => {
  it('reads the frontmatter and the text block under ## Prompt', () => {
    expect(parseClaudeHandoffFile(handoff(), SESSION)).toEqual({
      session: SESSION,
      created: '2026-09-27T11:44:15+03:00',
      branch: 'custom',
      head: 'f54a8d79001',
      pushed: 'no',
      prompt: 'Continue Orca+ «Штаб».\n\n## not a heading inside the fence'
    })
  })

  it('accepts CRLF line endings', () => {
    expect(parseClaudeHandoffFile(handoff().replace(/\n/g, '\r\n'), SESSION)?.prompt).toContain(
      'Continue Orca+'
    )
  })

  it('refuses a file written for another session', () => {
    expect(parseClaudeHandoffFile(handoff(), 'other-session')).toBeNull()
  })

  it('refuses a file that is not a strata handoff', () => {
    const frontmatter = `type: note\nsession: ${SESSION}\ncreated: 2026-09-27T11:44:15+03:00`
    expect(parseClaudeHandoffFile(handoff({ frontmatter }), SESSION)).toBeNull()
  })

  it('refuses a file without a readable created time', () => {
    const frontmatter = `type: strata-handoff\nsession: ${SESSION}\ncreated: soon`
    expect(parseClaudeHandoffFile(handoff({ frontmatter }), SESSION)).toBeNull()
  })

  it('refuses a missing, empty or unclosed prompt block', () => {
    expect(parseClaudeHandoffFile(handoff({ prompt: 'plain text' }), SESSION)).toBeNull()
    expect(parseClaudeHandoffFile(handoff({ prompt: '```text\n   \n```' }), SESSION)).toBeNull()
    expect(parseClaudeHandoffFile(handoff({ prompt: '```text\nnever closed' }), SESSION)).toBeNull()
  })

  it('refuses a text block that sits under another heading', () => {
    const prompt = '## Later\n```text\nwrong section\n```'
    expect(parseClaudeHandoffFile(handoff({ prompt }), SESSION)).toBeNull()
  })

  it('refuses a file without frontmatter', () => {
    expect(parseClaudeHandoffFile('## Prompt\n```text\nhi\n```\n', SESSION)).toBeNull()
  })
})

describe('claudeHandoffRelativePath', () => {
  it('builds the path strata:handoff writes', () => {
    expect(claudeHandoffRelativePath(SESSION)).toBe(`.claude/handoff/handoff-${SESSION}.md`)
  })

  it('refuses ids that could leave the handoff folder', () => {
    expect(claudeHandoffRelativePath('../../etc/passwd')).toBeNull()
    expect(claudeHandoffRelativePath('a/b')).toBeNull()
    expect(claudeHandoffRelativePath('')).toBeNull()
  })
})

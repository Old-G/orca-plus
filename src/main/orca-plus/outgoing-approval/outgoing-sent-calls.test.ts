import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  outgoingSentMessage,
  outgoingSentMessages,
  readOutgoingSentHook
} from './outgoing-sent-calls'
import { repoOfGitRemote } from './outgoing-sent-glab'

type SentCase = {
  case: string
  payload: unknown
  expect: { key: string; ts: string; text: string; link: string | null; title?: string } | null
}

const CASES: SentCase[] = readFileSync(
  join(__dirname, '__fixtures__', 'outgoing-sent-hooks.jsonl'),
  'utf8'
)
  .split('\n')
  .filter(Boolean)
  .map((line) => JSON.parse(line) as SentCase)

const repoOfCwd = async (cwd: string) => (cwd === '/Users/me/acme/app' ? 'acme/app' : null)

async function sent(payload: unknown) {
  const hook = readOutgoingSentHook(payload)
  return hook ? outgoingSentMessage(hook, repoOfCwd) : null
}

describe('outgoingSentMessage', () => {
  it.each(CASES.map((entry) => [entry.case, entry] as const))('%s', async (_name, entry) => {
    const message = await sent(entry.payload)
    if (entry.expect === null) {
      expect(message).toBeNull()
      return
    }
    expect(message).toMatchObject(entry.expect)
  })

  it('dates a Slack message by its ts and titles it by its first words', async () => {
    const reply = CASES.find((entry) => entry.case === 'slack-thread-reply')!
    expect(await sent(reply.payload)).toMatchObject({
      at: 1792707691438,
      title: 'Ann, the export is ready — please check the totals.'
    })
  })

  it('reads nothing from a failure, an error result or another event', async () => {
    const reply = CASES.find((entry) => entry.case === 'slack-thread-reply')!
    const payload = reply.payload as Record<string, unknown>
    expect(readOutgoingSentHook({ ...payload, hook_event_name: 'PostToolUseFailure' })).toBeNull()
    expect(readOutgoingSentHook({ ...payload, hook_event_name: 'PreToolUse' })).toBeNull()
    expect(
      readOutgoingSentHook({ ...payload, tool_response: { isError: true, content: [] } })
    ).toBeNull()
    expect(
      await sent({ ...payload, tool_response: [{ type: 'text', text: 'channel_not_found' }] })
    ).toBeNull()
  })

  it('takes a note glab printed without -R from the folder’s remote only when the URL needs it', async () => {
    const payload = {
      hook_event_name: 'PostToolUse',
      cwd: '/Users/me/acme/app',
      tool_name: 'Bash',
      tool_input: { command: 'glab mr note 3 -m "ok" 2>&1 | tail -1' },
      tool_response: { stdout: 'https://gitlab.example/acme/app/-/merge_requests/3#note_77\n' }
    }
    expect(await sent(payload)).toMatchObject({ key: 'gitlab:acme/app!3', ts: 'note:77' })
  })
})

describe('several glab notes in one command', () => {
  const bash = (command: string, stdout: string) => ({
    hook_event_name: 'PostToolUse',
    cwd: '/Users/me/acme/app',
    tool_name: 'Bash',
    tool_input: { command },
    tool_response: { stdout, stderr: '', interrupted: false, isImage: false }
  })

  it('gives each invocation the URL of its own MR and drops one that printed none', async () => {
    const hook = readOutgoingSentHook(
      bash(
        'glab mr note 12 -R acme/app -m "LGTM" --unique && glab mr note 14 -R acme/app -m "Bob, see !14"',
        'https://gitlab.com/acme/app/-/merge_requests/14#note_501\n'
      )
    )!
    expect(await outgoingSentMessages(hook, repoOfCwd)).toEqual([
      expect.objectContaining({ key: 'gitlab:acme/app!14', ts: 'note:501', text: 'Bob, see !14' })
    ])
  })

  it('records both when both posted, each with its own text', async () => {
    const hook = readOutgoingSentHook(
      bash(
        'glab mr note 12 -m "Ann, one" ; glab mr note 14 -m "Bob, two"',
        'https://gitlab.com/acme/app/-/merge_requests/12#note_500\nhttps://gitlab.com/acme/app/-/merge_requests/14#note_501\n'
      )
    )!
    expect((await outgoingSentMessages(hook, repoOfCwd)).map((m) => [m.key, m.ts, m.text])).toEqual(
      [
        ['gitlab:acme/app!12', 'note:500', 'Ann, one'],
        ['gitlab:acme/app!14', 'note:501', 'Bob, two']
      ]
    )
  })

  it('does not take a URL of another repo or MR', async () => {
    const hook = readOutgoingSentHook(
      bash(
        'glab mr note 12 -R acme/app -m "x"',
        'https://gitlab.com/acme/other/-/merge_requests/12#note_9\n'
      )
    )!
    expect(await outgoingSentMessages(hook, repoOfCwd)).toEqual([])
  })
})

describe('repoOfGitRemote', () => {
  it('reads group/name from ssh, scp-like and https remotes', () => {
    expect(repoOfGitRemote('git@gitlab-alias:acme/app.git')).toBe('acme/app')
    expect(repoOfGitRemote('git@gitlab.com:acme/sub/app.git')).toBe('acme/sub/app')
    expect(repoOfGitRemote('https://gitlab.com/acme/app.git')).toBe('acme/app')
    expect(repoOfGitRemote('ssh://git@gitlab.com/acme/app.git')).toBe('acme/app')
    expect(repoOfGitRemote('acme')).toBeNull()
  })
})

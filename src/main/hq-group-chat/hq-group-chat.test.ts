import { describe, expect, it, vi } from 'vitest'
import { join } from 'node:path'
import type { HqCommandResult } from '../hq-roster-sync/hq-roster-sync'
import type { ProjectGroup } from '../../shared/project-group-types'
import { createHqGroupChat, type HqGroupChatDeps } from './hq-group-chat'

const group: ProjectGroup = {
  id: 'g-1',
  name: 'Team A',
  parentPath: null,
  parentGroupId: null,
  createdFrom: 'manual',
  tabOrder: 0,
  isCollapsed: false,
  color: null,
  createdAt: 0,
  updatedAt: 0
}
const script = join('/hq', 'scripts', 'hq_group_chat.py')

function setup(result: HqCommandResult, overrides: Partial<HqGroupChatDeps> = {}) {
  const run = vi.fn(async (_program: string, _args: readonly string[], _cwd: string) => result)
  const chat = createHqGroupChat({
    hqPath: () => '/hq',
    fileExists: () => true,
    run,
    platform: 'darwin',
    refreshRegistry: vi.fn(async () => undefined),
    ...overrides
  })
  return { chat, run }
}

describe('createHqGroupChat', () => {
  it('runs the script with the group id and name and returns the chat folder', async () => {
    const report = JSON.stringify({ path: '/hq/chats/team-a', linked: ['alpha'], changed: true })
    const { chat, run } = setup({ code: 0, stdout: `${report}\n`, stderr: '' })
    await expect(chat.prepare(group)).resolves.toEqual({ ok: true, path: '/hq/chats/team-a' })
    expect(run).toHaveBeenCalledWith(
      'python3',
      [script, '--hq', '/hq', '--group-id', 'g-1', '--group', 'Team A'],
      '/hq'
    )
  })

  it('uses python on Windows', async () => {
    const { chat, run } = setup(
      { code: 0, stdout: '{"path":"C:/hq/chats/team-a"}', stderr: '' },
      { platform: 'win32' }
    )
    await chat.prepare(group)
    expect(run.mock.calls[0]?.[0]).toBe('python')
  })

  it('asks for the HQ folder when none is set', async () => {
    const { chat, run } = setup({ code: 0, stdout: '', stderr: '' }, { hqPath: () => '  ' })
    const result = await chat.prepare(group)
    expect(result.ok).toBe(false)
    expect(run).not.toHaveBeenCalled()
  })

  it('refuses a group from an SSH host, whose paths HQ cannot link', async () => {
    const { chat, run } = setup({ code: 0, stdout: '', stderr: '' })
    const result = await chat.prepare({ ...group, connectionId: 'ssh-1' })
    expect(result.ok).toBe(false)
    expect(run).not.toHaveBeenCalled()
  })

  it('names the missing script instead of running it', async () => {
    const { chat, run } = setup({ code: 0, stdout: '', stderr: '' }, { fileExists: () => false })
    const result = await chat.prepare(group)
    expect(result).toEqual({ ok: false, error: expect.stringContaining(script) })
    expect(run).not.toHaveBeenCalled()
  })

  it('refreshes the registry once for a group HQ does not know yet, then retries', async () => {
    const refreshRegistry = vi.fn(async () => undefined)
    const run = vi
      .fn<HqGroupChatDeps['run']>()
      .mockResolvedValueOnce({ code: 4, stdout: '', stderr: 'no project of group' })
      .mockResolvedValueOnce({ code: 0, stdout: '{"path":"/hq/chats/team-a"}', stderr: '' })
    const { chat } = setup({ code: 0, stdout: '', stderr: '' }, { run, refreshRegistry })
    await expect(chat.prepare(group)).resolves.toEqual({ ok: true, path: '/hq/chats/team-a' })
    expect(refreshRegistry).toHaveBeenCalledTimes(1)
    expect(run).toHaveBeenCalledTimes(2)
  })

  it('explains a group still missing after the refresh', async () => {
    const { chat, run } = setup({ code: 4, stdout: '', stderr: 'no project of group' })
    const result = await chat.prepare(group)
    expect(result).toEqual({ ok: false, error: expect.stringContaining("HQ's registry") })
    expect(run).toHaveBeenCalledTimes(2)
  })

  it('passes a script failure through', async () => {
    const { chat } = setup({ code: 3, stdout: '', stderr: 'hq_group_chat: no registry.yaml\n' })
    await expect(chat.prepare(group)).resolves.toEqual({
      ok: false,
      error: 'hq_group_chat: no registry.yaml'
    })
  })

  it('treats a report without a path as a failure', async () => {
    const { chat } = setup({ code: 0, stdout: 'not json', stderr: '' })
    const result = await chat.prepare(group)
    expect(result.ok).toBe(false)
  })
})

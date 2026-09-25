import { beforeEach, describe, expect, it, vi } from 'vitest'
import type * as ClickUpRequestModule from './clickup-request'

const { requestMock } = vi.hoisted(() => ({ requestMock: vi.fn() }))

vi.mock('./clickup-request', async (importOriginal) => ({
  ...(await importOriginal<typeof ClickUpRequestModule>()),
  clickUpRequest: requestMock
}))

vi.mock('./clickup-client', () => ({
  withClickUpSession: <T>(run: (session: unknown) => Promise<T>) =>
    run({ token: 'pk_test', viewer: { id: '7', username: 'me', email: null }, workspaceId: '42' })
}))

import { ClickUpApiError } from './clickup-request'
import {
  addClickUpTaskComment,
  listClickUpTasks,
  searchClickUpTasks,
  updateClickUpTaskStatus
} from './clickup-tasks'

function task(id: string, name: string, type = 'open', customId: string | null = null) {
  return { id, custom_id: customId, name, status: { status: type, type } }
}

function page(tasks: unknown[], lastPage = true) {
  return { tasks, last_page: lastPage }
}

beforeEach(() => {
  requestMock.mockReset()
})

describe('listClickUpTasks', () => {
  it('asks for my tasks in the selected workspace and hides done statuses', async () => {
    requestMock.mockResolvedValueOnce(
      page([
        task('a1b2c3d', 'Open'),
        task('a1b2c3e', 'Checked', 'done'),
        task('a1b2c3f', 'Wip', 'custom')
      ])
    )
    const tasks = await listClickUpTasks({ scope: 'mine', spaceId: 's1' })
    expect(tasks.map((entry) => entry.title)).toEqual(['Open', 'Wip'])
    const path = String(requestMock.mock.calls[0][1])
    expect(path).toMatch(/^\/team\/42\/task\?/)
    const query = new URLSearchParams(path.split('?')[1])
    expect(query.getAll('assignees[]')).toEqual(['7'])
    expect(query.getAll('space_ids[]')).toEqual(['s1'])
    expect(query.get('include_closed')).toBe('false')
  })

  it('keeps paging until enough open tasks are collected', async () => {
    requestMock
      .mockResolvedValueOnce(page([task('a1b2c3d', 'Done', 'done')], false))
      .mockResolvedValueOnce(page([task('a1b2c3e', 'Later')]))
    const tasks = await listClickUpTasks({ scope: 'all' }, 5)
    expect(tasks.map((entry) => entry.title)).toEqual(['Later'])
    expect(requestMock).toHaveBeenCalledTimes(2)
    expect(String(requestMock.mock.calls[1][1])).toContain('page=1')
  })
})

describe('searchClickUpTasks', () => {
  it('looks a custom id up directly', async () => {
    requestMock.mockResolvedValueOnce(task('86cbcnw23', 'Found', 'open', 'DEV-17089'))
    const tasks = await searchClickUpTasks('DEV-17089', { scope: 'mine' })
    expect(tasks.map((entry) => entry.identifier)).toEqual(['DEV-17089'])
    expect(String(requestMock.mock.calls[0][1])).toBe(
      '/task/DEV-17089?include_markdown_description=true&custom_task_ids=true&team_id=42'
    )
  })

  it('falls back to title search when an id-shaped word is not a task', async () => {
    requestMock
      .mockRejectedValueOnce(new ClickUpApiError('Team not authorized', 401, 'OAUTH_027'))
      .mockResolvedValueOnce(page([task('a1b2c3d', 'Deploy gpt6xyz'), task('a1b2c3e', 'Other')]))
    const tasks = await searchClickUpTasks('gpt6xyz', { scope: 'mine' })
    expect(tasks.map((entry) => entry.title)).toEqual(['Deploy gpt6xyz'])
  })

  it('does not swallow a rejected token during id lookup', async () => {
    requestMock.mockRejectedValueOnce(new ClickUpApiError('bad token', 401, 'OAUTH_019'))
    await expect(searchClickUpTasks('DEV-1', { scope: 'mine' })).rejects.toThrow('bad token')
  })
})

describe('write-back', () => {
  it('sets the status by name and posts comments without notifying everyone', async () => {
    requestMock.mockResolvedValue({})
    await expect(updateClickUpTaskStatus('t1', 'in proсess')).resolves.toEqual({ ok: true })
    expect(requestMock.mock.calls[0][1]).toBe('/task/t1')
    expect(requestMock.mock.calls[0][2]).toMatchObject({
      method: 'PUT',
      body: JSON.stringify({ status: 'in proсess' })
    })
    await addClickUpTaskComment('t1', ' hello ')
    expect(JSON.parse(String(requestMock.mock.calls[1][2].body))).toEqual({
      comment_text: 'hello',
      notify_all: false
    })
  })

  it('reports a failed update instead of throwing', async () => {
    requestMock.mockRejectedValueOnce(new ClickUpApiError('Status not found', 400))
    await expect(updateClickUpTaskStatus('t1', 'nope')).resolves.toEqual({
      ok: false,
      error: 'Status not found'
    })
  })
})

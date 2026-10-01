import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { HELD_SHELL_COMMANDS, PASSED_SHELL_COMMANDS } from './__fixtures__/outgoing-shell-commands'
import { classifyOutgoingToolCall } from './outgoing-action-classifier'

function fixtureLines(name: string): string[] {
  return readFileSync(join(__dirname, '__fixtures__', name), 'utf8')
    .split('\n')
    .filter(Boolean)
}

const bash = (command: string) => classifyOutgoingToolCall('Bash', { command })

describe('connector tools seen in real transcripts', () => {
  // Why: every name the claude.ai connectors exposed on 01.10.2026 (in-house ones renamed Team_*);
  // the held list was reviewed by hand.
  const names = fixtureLines('claude-ai-connector-tools.txt')
  const held = new Set(fixtureLines('claude-ai-connector-tools.held.txt'))

  it('holds exactly the reviewed send and delete tools', () => {
    const actual = names.filter((name) => classifyOutgoingToolCall(name, {}) !== null)
    expect(actual.sort()).toEqual([...held].sort())
  })

  it('covers the channels Gleb uses to reach people', () => {
    for (const name of [
      'mcp__claude_ai_Slack__slack_send_message',
      'mcp__claude_ai_ClickUp__clickup_send_chat_message',
      'mcp__claude_ai_Zoho_Desk__sendReply',
      'mcp__claude_ai_Gmail__send_message'
    ]) {
      expect(held.has(name)).toBe(true)
    }
  })
})

describe('MCP call details', () => {
  it('shows the Slack message and lets Edit replace it', () => {
    expect(
      classifyOutgoingToolCall('mcp__claude_ai_Slack__slack_send_message', {
        channel_id: 'D123',
        message: 'Привет, Анна!',
        thread_ts: '1.2'
      })
    ).toEqual({
      service: 'Slack',
      operation: 'send message',
      draftKind: 'message',
      target: 'D123',
      body: 'Привет, Анна!',
      editField: 'message'
    })
  })

  it('holds a ClickUp task rewrite of its name or description, passes other task writes', () => {
    const update = (input: Record<string, unknown>) =>
      classifyOutgoingToolCall('mcp__claude_ai_ClickUp__clickup_update_task', input)
    expect(update({ task_id: '86abc', markdown_description: 'Зачем…' })).toMatchObject({
      target: '86abc',
      editField: 'markdown_description'
    })
    expect(update({ task_id: '86abc', status: 'check', name: 'Renamed' })).not.toBeNull()
    expect(update({ task_id: '86abc', status: 'check', priority: 2 })).toBeNull()
    for (const tool of [
      'clickup_create_task',
      'clickup_create_task_comment',
      'clickup_move_task'
    ]) {
      expect(
        classifyOutgoingToolCall(`mcp__claude_ai_ClickUp__${tool}`, { task_id: '1' })
      ).toBeNull()
    }
  })

  it('holds what the ClickUp operator tool deletes, merges, messages or retitles', () => {
    const run = (input: Record<string, unknown>) =>
      classifyOutgoingToolCall('mcp__claude_ai_ClickUp__clickup_execute_operator', input)
    expect(
      run({ model: 'task', operator: 'delete_many', body: { ids: ['1', '2'] } })
    ).not.toBeNull()
    expect(run({ model: 'task', operator: 'merge', parameters: { task_id: '1' } })).not.toBeNull()
    expect(
      run({ model: 'chat_message', operator: 'create', body: { content: 'hi' } })
    ).not.toBeNull()
    expect(
      run({ model: 'task', operator: 'update_many', body: { tasks: [{ id: '1', name: 'x' }] } })
    ).not.toBeNull()
    expect(
      run({
        model: 'task',
        operator: 'update_many',
        body: { tasks: [{ id: '1', status: 'check' }] }
      })
    ).toBeNull()
    expect(
      run({ model: 'task', operator: 'create_many', body: { tasks: [{ name: 'x' }] } })
    ).toBeNull()
    expect(run({ model: 'task', operator: 'get_many' })).toBeNull()
  })

  it('shows the whole input and offers no edit when no text field exists', () => {
    const deletion = classifyOutgoingToolCall('mcp__claude_ai_ClickUp__clickup_delete_task', {
      task_id: '86abc',
      list_id: '901'
    })
    expect(deletion).toMatchObject({ editField: null, target: '86abc', draftKind: 'other' })
    expect(deletion?.body).toContain('"list_id": "901"')
  })

  it('holds a public ticket comment and an event with attendees only', () => {
    const comment = (isPublic: boolean) =>
      classifyOutgoingToolCall('mcp__claude_ai_Zoho_Desk__createTicketComment', {
        ticketId: '7',
        content: 'Hi',
        isPublic
      })
    expect(comment(true)).not.toBeNull()
    expect(comment(false)).toBeNull()
    const event = (attendees: string[]) =>
      classifyOutgoingToolCall('mcp__claude_ai_Google_Calendar__create_event', {
        title: 'Sync',
        attendees
      })
    expect(event(['anna@example.com'])).not.toBeNull()
    expect(event([])).toBeNull()
  })

  it('passes local, browser and private-doc servers', () => {
    expect(classifyOutgoingToolCall('mcp__ide__getDiagnostics', {})).toBeNull()
    expect(classifyOutgoingToolCall('mcp__claude-in-chrome__form_input', {})).toBeNull()
    expect(
      classifyOutgoingToolCall('mcp__plugin_playwright_playwright__browser_file_upload', {})
    ).toBeNull()
    expect(classifyOutgoingToolCall('mcp__claude_ai_Claude_Docs__update', {})).toBeNull()
  })

  it('holds sends and deletes of servers it has never seen, passes their other writes', () => {
    expect(classifyOutgoingToolCall('mcp__telegram__send_message', {})).not.toBeNull()
    expect(classifyOutgoingToolCall('mcp__gitlab__delete_branch', {})).not.toBeNull()
    expect(classifyOutgoingToolCall('mcp__gitlab__merge_merge_request', {})).toBeNull()
    expect(classifyOutgoingToolCall('mcp__linear__save_issue', {})).toBeNull()
    expect(classifyOutgoingToolCall('mcp__slack__send_message_draft', {})).toBeNull()
  })

  it('ignores tools that are not MCP or Bash', () => {
    expect(classifyOutgoingToolCall('Write', { file_path: '/tmp/x', content: 'send' })).toBeNull()
    expect(classifyOutgoingToolCall('WebFetch', { url: 'https://example.com' })).toBeNull()
  })
})

describe('shell commands', () => {
  it.each(HELD_SHELL_COMMANDS)('holds %s', (command) => {
    const action = bash(command)
    expect(action).not.toBeNull()
    expect(action?.editField).toBe('command')
    expect(action?.body).toBe(command)
  })

  it.each(PASSED_SHELL_COMMANDS)('passes %s', (command) => {
    expect(bash(command)).toBeNull()
  })

  it('names the remote host when the command has one', () => {
    expect(bash('curl -X DELETE https://api.clickup.com/api/v2/task/1')?.target).toBe(
      'api.clickup.com'
    )
  })

  it('passes an empty or missing command', () => {
    expect(bash('   ')).toBeNull()
    expect(classifyOutgoingToolCall('Bash', {})).toBeNull()
  })
})

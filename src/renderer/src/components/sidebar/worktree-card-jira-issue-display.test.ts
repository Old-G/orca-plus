import { describe, expect, it } from 'vitest'
import { getWorktreeCardJiraIssueDisplay } from './worktree-card-jira-issue-display'

describe('getWorktreeCardJiraIssueDisplay', () => {
  it('projects a linked ClickUp task by its custom id', () => {
    expect(
      getWorktreeCardJiraIssueDisplay({
        linkedWorkItem: {
          provider: 'clickup',
          type: 'issue',
          number: 0,
          clickupIdentifier: 'DEV-17092',
          title: 'DEV-17092 T2-A7 · Agents reach the hub',
          url: 'https://app.clickup.com/t/86cbcnw6g'
        }
      })
    ).toEqual({
      provider: 'clickup',
      identifier: 'DEV-17092',
      title: 'T2-A7 · Agents reach the hub',
      url: 'https://app.clickup.com/t/86cbcnw6g'
    })
  })
})

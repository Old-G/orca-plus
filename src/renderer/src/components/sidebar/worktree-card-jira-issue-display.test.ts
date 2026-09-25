import { describe, expect, it } from 'vitest'
import {
  getConfiguredWorktreeCardJiraIssueDisplay,
  getWorktreeCardJiraIssueDisplay
} from './worktree-card-jira-issue-display'

describe('getWorktreeCardJiraIssueDisplay', () => {
  it('projects persisted Jira linked-item metadata for the workspace card', () => {
    expect(
      getWorktreeCardJiraIssueDisplay({
        linkedWorkItem: {
          provider: 'jira',
          type: 'issue',
          number: 1,
          jiraIdentifier: 'KAN-1',
          title: 'KAN-1 Test Jira card icon',
          url: 'https://company.atlassian.net/browse/KAN-1'
        }
      })
    ).toEqual({
      provider: 'jira',
      identifier: 'KAN-1',
      title: 'Test Jira card icon',
      url: 'https://company.atlassian.net/browse/KAN-1'
    })
  })

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

  it('does not infer Jira from another provider', () => {
    expect(
      getWorktreeCardJiraIssueDisplay({
        linkedWorkItem: {
          provider: 'linear',
          type: 'issue',
          number: 1,
          linearIdentifier: 'ENG-1',
          title: 'Linear issue',
          url: 'https://linear.app/acme/issue/ENG-1'
        }
      })
    ).toBeNull()
  })

  it('shows persisted Jira metadata only when the Jira display property is enabled', () => {
    const worktree = {
      linkedWorkItem: {
        provider: 'jira' as const,
        type: 'issue' as const,
        number: 1,
        jiraIdentifier: 'KAN-1',
        title: 'Test Jira card preference',
        url: 'https://company.atlassian.net/browse/KAN-1'
      }
    }

    expect(getConfiguredWorktreeCardJiraIssueDisplay(worktree, [])).toBeNull()
    expect(getConfiguredWorktreeCardJiraIssueDisplay(worktree, ['jira-issue'])).toMatchObject({
      identifier: 'KAN-1',
      title: 'Test Jira card preference'
    })
  })
})

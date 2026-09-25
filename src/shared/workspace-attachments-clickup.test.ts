import { describe, expect, it } from 'vitest'
import { normalizeWorkspaceAttachmentUpdate } from './workspace-attachments'
import type { WorkspaceLinkedItem } from './worktree/types'

const CLICKUP: WorkspaceLinkedItem = {
  provider: 'clickup',
  type: 'issue',
  number: 0,
  title: 'Доступ агентов к Hub',
  url: 'https://app.clickup.com/t/86cbcnw6g',
  clickupIdentifier: 'DEV-17092'
}

describe('ClickUp link and workspace attachments', () => {
  it('survives linking a review to the workspace', () => {
    const result = normalizeWorkspaceAttachmentUpdate(
      { linkedWorkItem: CLICKUP },
      {
        linkedItems: [
          { provider: 'github', type: 'pr', number: 42, url: 'https://github.com/o/r/pull/42' }
        ]
      }
    )
    expect(result.linkedWorkItem).toEqual(CLICKUP)
  })

  it('is still removed when the owner unlinks it', () => {
    const result = normalizeWorkspaceAttachmentUpdate(
      { linkedWorkItem: CLICKUP },
      { linkedWorkItem: null, linkedItems: [] }
    )
    expect(result.linkedWorkItem ?? null).toBeNull()
  })
})

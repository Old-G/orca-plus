import { describe, expect, it } from 'vitest'
import { toFolderWorkspaceLinkedTask } from './folder-workspace-source-selection'

// Custom build (clickup-workspace-link): kept from the composer-helpers suite upstream removed.
describe('toFolderWorkspaceLinkedTask', () => {
  it('keeps the ClickUp custom id so the sidebar badge can show it', () => {
    expect(
      toFolderWorkspaceLinkedTask({
        type: 'issue',
        provider: 'clickup',
        number: 0,
        title: 'DEV-17664 Write-back',
        url: 'https://app.clickup.com/t/12487v2bqy0',
        clickupIdentifier: 'DEV-17664'
      })
    ).toMatchObject({ provider: 'clickup', clickupIdentifier: 'DEV-17664' })
  })
})

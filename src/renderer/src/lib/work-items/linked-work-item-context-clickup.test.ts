import { describe, expect, it } from 'vitest'
import {
  getLaunchableWorkItemDraftContent,
  resolveQuickCreateLinkedWorkItemPrompt
} from './linked-work-item-context'

// Custom build (clickup-workspace-link): ClickUp cases kept apart from the suite upstream trimmed.
const CLICKUP_ITEM = {
  provider: 'clickup' as const,
  clickupIdentifier: 'DEV-17664',
  title: 'DEV-17664 Write-back',
  url: 'https://app.clickup.com/t/12487v2bqy0',
  linkedContext: {
    provider: 'clickup' as const,
    version: 1 as const,
    renderedText: 'ClickUp task DEV-17664: Write-back\n\nSecret description'
  }
}

describe('resolveQuickCreateLinkedWorkItemPrompt with ClickUp', () => {
  it('drafts the note above the ClickUp id and link, without the task prose', () => {
    const result = resolveQuickCreateLinkedWorkItemPrompt({ number: 0, ...CLICKUP_ITEM }, 'note')

    expect(result).toEqual({
      prompt: '',
      draftPrompt: 'note\n\nLinked ClickUp task: DEV-17664\nhttps://app.clickup.com/t/12487v2bqy0\n'
    })
    expect(result.draftPrompt).not.toContain('Secret description')
  })
})

describe('getLaunchableWorkItemDraftContent with ClickUp', () => {
  it('drafts only the ClickUp id and link for ClickUp tasks', () => {
    expect(getLaunchableWorkItemDraftContent({ pasteContent: '', ...CLICKUP_ITEM })).toBe(
      'Linked ClickUp task: DEV-17664\nhttps://app.clickup.com/t/12487v2bqy0\n'
    )
  })

  it('falls back to the URL for a ClickUp task without a custom id', () => {
    expect(
      getLaunchableWorkItemDraftContent({
        provider: 'clickup',
        pasteContent: '',
        url: 'https://app.clickup.com/t/12487v2bqy0'
      })
    ).toBe('https://app.clickup.com/t/12487v2bqy0')
  })
})

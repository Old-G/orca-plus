// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FILE_EXPLORER_FOCUS_SETTLE_MS, keepFileExplorerFocus } from './file-explorer-focus-keeper'

function mount(): { row: HTMLButtonElement; editor: HTMLTextAreaElement } {
  const shell = document.createElement('div')
  shell.setAttribute('data-orca-explorer-shell', '')
  const row = document.createElement('button')
  shell.append(row)
  const editor = document.createElement('textarea')
  document.body.append(shell, editor)
  return { row, editor }
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  document.body.replaceChildren()
})

async function settle<T>(promise: Promise<T>): Promise<T> {
  await vi.advanceTimersByTimeAsync(FILE_EXPLORER_FOCUS_SETTLE_MS)
  return promise
}

describe('keepFileExplorerFocus', () => {
  it('hands focus back when the operation lets the editor take it', async () => {
    const { row, editor } = mount()
    row.focus()
    const result = keepFileExplorerFocus(async () => {
      setTimeout(() => editor.focus(), 150)
      return 42
    })
    expect(await settle(result)).toBe(42)
    expect(document.activeElement).toBe(row)
  })

  it('leaves focus where the user put it during the operation', async () => {
    const { row, editor } = mount()
    row.focus()
    const result = keepFileExplorerFocus(async () => {
      editor.dispatchEvent(new Event('pointerdown', { bubbles: true }))
      editor.focus()
    })
    await settle(result)
    expect(document.activeElement).toBe(editor)
  })

  it('does nothing when the operation did not start from the explorer', async () => {
    const { editor } = mount()
    editor.focus()
    await settle(keepFileExplorerFocus(async () => undefined))
    expect(document.activeElement).toBe(editor)
  })

  it('stops watching after the settle window', async () => {
    const { row, editor } = mount()
    row.focus()
    await settle(keepFileExplorerFocus(async () => undefined))
    editor.focus()
    expect(document.activeElement).toBe(editor)
  })
})

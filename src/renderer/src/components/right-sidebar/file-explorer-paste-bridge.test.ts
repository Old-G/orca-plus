// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from 'vitest'
import {
  clipboardEventCarriesFiles,
  isFileExplorerClipboardEvent,
  resolveFileExplorerClipboardNodes,
  shouldHandleFileExplorerPasteEvent
} from './file-explorer-paste-bridge'
import type { TreeNode } from './file-explorer-types'

function pasteEventOn(target: Element, types: string[]): ClipboardEvent {
  const event = new ClipboardEvent('paste', { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'clipboardData', { value: { types } })
  Object.defineProperty(event, 'target', { value: target })
  return event
}

function mountExplorer(): { row: HTMLButtonElement; filter: HTMLInputElement } {
  const shell = document.createElement('div')
  shell.setAttribute('data-orca-explorer-shell', '')
  const row = document.createElement('button')
  const filter = document.createElement('input')
  shell.append(row, filter)
  document.body.append(shell)
  return { row, filter }
}

afterEach(() => {
  document.body.replaceChildren()
})

describe('file explorer paste bridge', () => {
  it('detects files on the clipboard', () => {
    const row = document.createElement('button')
    expect(clipboardEventCarriesFiles(pasteEventOn(row, ['Files']))).toBe(true)
    expect(clipboardEventCarriesFiles(pasteEventOn(row, ['text/plain']))).toBe(false)
    expect(clipboardEventCarriesFiles({ clipboardData: null })).toBe(false)
  })

  it('handles a Finder file paste on a focused explorer row', () => {
    const { row } = mountExplorer()
    expect(shouldHandleFileExplorerPasteEvent(pasteEventOn(row, ['Files']))).toBe(true)
  })

  it('leaves text pastes alone so they keep their default behavior', () => {
    const { row } = mountExplorer()
    expect(shouldHandleFileExplorerPasteEvent(pasteEventOn(row, ['text/plain']))).toBe(false)
  })

  it('never steals a paste from the explorer filter input', () => {
    const { filter } = mountExplorer()
    expect(shouldHandleFileExplorerPasteEvent(pasteEventOn(filter, ['Files']))).toBe(false)
  })

  it('ignores pastes outside the explorer (editor, terminal)', () => {
    const outside = document.createElement('div')
    document.body.append(outside)
    expect(shouldHandleFileExplorerPasteEvent(pasteEventOn(outside, ['Files']))).toBe(false)
  })

  it('claims cut/copy when a row has focus even if the DOM selection is elsewhere', () => {
    const { row } = mountExplorer()
    const chat = document.createElement('p')
    document.body.append(chat)
    row.focus()
    expect(isFileExplorerClipboardEvent({ target: chat })).toBe(true)
    row.blur()
    expect(isFileExplorerClipboardEvent({ target: chat })).toBe(false)
  })

  it('leaves cut/copy in the focused explorer filter to the input', () => {
    const { filter } = mountExplorer()
    filter.focus()
    expect(isFileExplorerClipboardEvent({ target: filter })).toBe(false)
  })

  it('acts on a multi-selection as a whole, otherwise on the focused row', () => {
    const node = (path: string): TreeNode => ({
      name: path.slice(3),
      path,
      relativePath: path.slice(3),
      isDirectory: false,
      depth: 0
    })
    const a = node('/r/a')
    const b = node('/r/b')
    const c = node('/r/c')
    expect(resolveFileExplorerClipboardNodes(c, [a, b])).toEqual([a, b])
    expect(resolveFileExplorerClipboardNodes(c, [a])).toEqual([c])
    expect(resolveFileExplorerClipboardNodes(null, [a])).toEqual([a])
    expect(resolveFileExplorerClipboardNodes(null, [])).toEqual([])
  })
})

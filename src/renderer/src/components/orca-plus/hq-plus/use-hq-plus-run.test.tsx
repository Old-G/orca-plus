// @vitest-environment happy-dom

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/i18n/i18n', () => ({ translate: (_key: string, fallback: string) => fallback }))

import { useHqPlusRun } from './HqPlusCardShell'

afterEach(() => cleanup())

describe('useHqPlusRun', () => {
  it('tells onDone which button ran, so a card can stay open after one that only opens a chat', async () => {
    const onDone = vi.fn()
    let run: ReturnType<typeof useHqPlusRun>['run'] | null = null
    function Probe(): null {
      run = useHqPlusRun(onDone).run
      return null
    }
    render(<Probe />)
    await act(async () => {
      run!(async () => ({ ok: true }), 'open')
    })
    await act(async () => {
      run!(async () => ({ ok: true }))
    })
    expect(onDone.mock.calls).toEqual([['open'], [null]])
  })

  it('keeps the card open after its open-chat buttons and folds it after the rest (owner 09.11)', () => {
    const source = readFileSync(
      resolve('src/renderer/src/components/orca-plus/hq-plus/HqPlusCard.tsx'),
      'utf8'
    )
    expect(source).toMatch(
      /useHqPlusRun\(\(key\) => \{[\s\S]*?if \(!key \|\| !OPEN_CHAT_ACTIONS\.has\(key\)\) \{\s*setExpanded\(false\)/
    )
  })
})

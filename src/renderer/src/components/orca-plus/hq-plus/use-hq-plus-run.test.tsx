// @vitest-environment happy-dom

import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useHqPlusRun } from './HqPlusCardShell'

describe('useHqPlusRun (13.11: a card shown settled at once comes back on a failure)', () => {
  it('calls onDone on success and onFailed with the key on a refusal or a throw', async () => {
    const onDone = vi.fn()
    const onFailed = vi.fn()
    const { result } = renderHook(() => useHqPlusRun(onDone, onFailed))
    await act(async () => {
      result.current.run(async () => ({ ok: true }), 'done')
    })
    expect(onDone).toHaveBeenCalledWith('done')
    expect(onFailed).not.toHaveBeenCalled()
    await act(async () => {
      result.current.run(async () => ({ ok: false, message: 'no bell' }), 'got-it')
    })
    expect(onFailed).toHaveBeenCalledWith('got-it', 'no bell')
    expect(result.current.error).toBe('no bell')
    await act(async () => {
      result.current.run(async () => {
        throw new Error('gone')
      }, 'skip')
    })
    expect(onFailed).toHaveBeenLastCalledWith('skip', 'gone')
    expect(result.current.error).toBe('gone')
  })
})

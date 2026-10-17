import { createElement } from 'react'
import { act, create } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'

const run = vi.hoisted(() => vi.fn())
vi.mock('../transport/rpc-operation', () => ({
  runRpcOperation: run,
  defineRpcOperation: (definition: unknown) => definition
}))

import type { RpcClient } from '../transport/rpc-client'
import {
  closeMobileVoicePrompt,
  offerMobileVoicePrompt,
  useMobileVoicePrompt,
  type MobileVoicePrompt
} from './mobile-voice-prompt'

// oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: runRpcOperation is mocked; the client is never used.
const client = {} as RpcClient

let seen: MobileVoicePrompt | null = null
function Probe(): null {
  seen = useMobileVoicePrompt()
  return null
}

afterEach(() => {
  act(() => closeMobileVoicePrompt())
  run.mockReset()
})

describe('offerMobileVoicePrompt', () => {
  it('holds the transcript when the Mac has voice prompts on', async () => {
    run.mockResolvedValue({ hqVoicePromptsEnabled: true })
    const insert = vi.fn()
    act(() => {
      create(createElement(Probe))
    })
    await act(() => offerMobileVoicePrompt(client, ' для агента почини тест ', insert))
    expect(insert).not.toHaveBeenCalled()
    expect(seen?.text).toBe('для агента почини тест')
  })

  it('inserts right away when they are off, the Mac is older, or it cannot be asked', async () => {
    const insert = vi.fn()
    run.mockResolvedValueOnce({ hqVoicePromptsEnabled: false })
    await offerMobileVoicePrompt(client, 'раз', insert)
    run.mockResolvedValueOnce({})
    await offerMobileVoicePrompt(client, 'два', insert)
    run.mockRejectedValueOnce(new Error('method_not_found'))
    await offerMobileVoicePrompt(client, 'три', insert)
    await offerMobileVoicePrompt(null, 'четыре', insert)
    expect(insert.mock.calls.map(([text]) => text)).toEqual(['раз', 'два', 'три', 'четыре'])
  })
})

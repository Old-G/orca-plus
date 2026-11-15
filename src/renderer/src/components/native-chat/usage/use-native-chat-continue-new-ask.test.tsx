// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  NativeChatContinueNewContext,
  type NativeChatContinueNew
} from './native-chat-continue-new-context'
import { useNativeChatContinueNewAsk } from './use-native-chat-continue-new-ask'
import { NativeChatContinueNewAskBar } from './NativeChatContinueNew'
import type { NativeChatStructuredComposerTransport } from '../composer/submit/native-chat-structured-composer-transport'
import type { NativeChatComposerImageAttachment } from '../attachments/chips/native-chat-image-attachment'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

vi.mock('@/i18n/i18n', () => ({
  translate: (_key: string, fallback: string, values?: Record<string, string>) =>
    fallback.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => values?.[name] ?? '')
}))

type Gate = ReturnType<typeof useNativeChatContinueNewAsk>

let container: HTMLDivElement
let root: Root
let gate: Gate
let send: ReturnType<typeof vi.fn<NativeChatStructuredComposerTransport['send']>>
let submit: ReturnType<typeof vi.fn<() => void>>
let start: ReturnType<typeof vi.fn<NativeChatContinueNew['start']>>
let transport: NativeChatStructuredComposerTransport

function Harness(): React.JSX.Element | null {
  gate = useNativeChatContinueNewAsk(transport, submit)
  return gate.ask ? <NativeChatContinueNewAskBar ask={gate.ask} /> : null
}

function render(offer: NativeChatContinueNew | null): void {
  act(() => {
    root.render(
      <NativeChatContinueNewContext.Provider value={offer}>
        <Harness />
      </NativeChatContinueNewContext.Provider>
    )
  })
}

function offer(): NativeChatContinueNew {
  return { usedTokens: 420_000, idleMs: 3 * 60 * 60_000, starting: false, start }
}

function sendThroughGate(
  text: string,
  attachments: readonly NativeChatComposerImageAttachment[] = []
): ReturnType<NativeChatStructuredComposerTransport['send']> {
  let result: ReturnType<NativeChatStructuredComposerTransport['send']> = false
  act(() => {
    result = gate.transport!.send(text, attachments)
  })
  return result
}

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  send = vi.fn<NativeChatStructuredComposerTransport['send']>(() => true)
  submit = vi.fn<() => void>()
  start = vi.fn<NativeChatContinueNew['start']>(() => Promise.resolve(true))
  transport = { send } as unknown as NativeChatStructuredComposerTransport
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe('useNativeChatContinueNewAsk', () => {
  it('sends as before in a chat that is not due', () => {
    render(null)
    expect(sendThroughGate('hello')).toBe(true)
    expect(send).toHaveBeenCalledWith('hello', [])
    expect(gate.ask).toBeNull()
  })

  it('asks on the first send of a due chat and keeps the message', () => {
    render(offer())
    expect(sendThroughGate('Threshold 300k, go.')).toBe(false)
    expect(send).not.toHaveBeenCalled()
    expect(start).not.toHaveBeenCalled()
    expect(container.querySelector('[data-native-chat-continue-new-ask]')?.textContent).toContain(
      'Idle 3 h · 420k context.'
    )
  })

  it('starts the new chat with the message on the second Enter', async () => {
    render(offer())
    sendThroughGate('Threshold 300k, go.')
    const second = sendThroughGate('Threshold 300k, go.')
    expect(start).toHaveBeenCalledWith('Threshold 300k, go.')
    await expect(second).resolves.toBe(true)
    expect(send).not.toHaveBeenCalled()
    expect(gate.ask).toBeNull()
  })

  it('«New chat with this message» submits the draft into the new chat', () => {
    render(offer())
    sendThroughGate('hi')
    const button = [...container.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('New chat with this message')
    )
    act(() => button!.click())
    expect(submit).toHaveBeenCalledTimes(1)
    sendThroughGate('hi')
    expect(start).toHaveBeenCalledWith('hi')
    expect(send).not.toHaveBeenCalled()
  })

  it('«Send here» submits the draft to this chat', () => {
    render(offer())
    sendThroughGate('hi')
    const button = [...container.querySelectorAll('button')].find(
      (b) => b.textContent === 'Send here'
    )
    act(() => button!.click())
    expect(submit).toHaveBeenCalledTimes(1)
    expect(sendThroughGate('hi')).toBe(true)
    expect(send).toHaveBeenCalledWith('hi', [])
    expect(start).not.toHaveBeenCalled()
    expect(gate.ask).toBeNull()
  })

  it('asks again after Esc instead of starting a new chat', () => {
    render(offer())
    sendThroughGate('hi')
    act(() => gate.ask!.dismiss())
    expect(gate.ask).toBeNull()
    expect(sendThroughGate('hi')).toBe(false)
    expect(start).not.toHaveBeenCalled()
  })

  it('sends a message with images here, since they cannot move', () => {
    render(offer())
    const image = { id: 'img-1', path: '/tmp/a.png' } as NativeChatComposerImageAttachment
    expect(sendThroughGate('look', [image])).toBe(true)
    expect(send).toHaveBeenCalledWith('look', [image])
    expect(gate.ask).toBeNull()
  })

  it('sends a slash command or a picked skill here, since it only runs at the message start', () => {
    render(offer())
    expect(sendThroughGate('/review')).toBe(true)
    expect(send).toHaveBeenCalledWith('/review', [])
    let result: ReturnType<NativeChatStructuredComposerTransport['send']> = false
    act(() => {
      result = gate.transport!.send('use it', [], {
        skills: [{ name: 'x' }] as never
      })
    })
    expect(result).toBe(true)
    expect(gate.ask).toBeNull()
    expect(start).not.toHaveBeenCalled()
  })

  it('forgets the question once the chat is no longer due', () => {
    render(offer())
    sendThroughGate('hi')
    render(null)
    render(offer())
    expect(gate.ask).toBeNull()
    expect(sendThroughGate('hi')).toBe(false)
    expect(start).not.toHaveBeenCalled()
  })
})

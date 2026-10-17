import { createElement, type ReactNode } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'

const run = vi.hoisted(() => vi.fn())

vi.mock('react-native', () => ({
  Pressable: 'Pressable',
  StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
  Text: 'Text',
  TextInput: 'TextInput',
  View: 'View'
}))
vi.mock('../components/BottomDrawer', () => ({
  BottomDrawer: ({ visible, children }: { visible: boolean; children: ReactNode }) =>
    visible ? children : null
}))
vi.mock('../transport/rpc-operation', () => ({
  runRpcOperation: run,
  defineRpcOperation: (definition: { name: string }) => definition
}))

import type { RpcClient } from '../transport/rpc-client'
import { MobileVoicePromptSheet } from './MobileVoicePromptSheet'
import { closeMobileVoicePrompt, offerMobileVoicePrompt } from './mobile-voice-prompt'

// oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: runRpcOperation is mocked; the client is never used.
const client = {} as RpcClient
const showToast = vi.fn()

function reply(operation: { name: string }, params: { mode?: string; text: string }) {
  switch (operation.name) {
    case 'hq.settings':
      return { hqVoicePromptsEnabled: true }
    case 'hq.voice-rewrite':
      return { ok: true, text: `[${params.mode}] готово` }
    default:
      return { ok: true, url: 'https://app.clickup.com/t/1' }
  }
}

async function open(text: string, insert: (text: string) => void): Promise<ReactTestRenderer> {
  run.mockImplementation(async (_client: unknown, operation: { name: string }, params: never) =>
    reply(operation, params)
  )
  let renderer: ReactTestRenderer | null = null
  await act(async () => {
    renderer = create(createElement(MobileVoicePromptSheet, { client, showToast }))
  })
  await act(() => offerMobileVoicePrompt(client, text, insert))
  await act(async () => {
    await Promise.resolve()
  })
  if (!renderer) {
    throw new Error('sheet did not render')
  }
  return renderer
}

function press(renderer: ReactTestRenderer, label: string): Promise<void> {
  return act(async () => {
    renderer.root.findByProps({ accessibilityLabel: label }).props.onPress()
    await Promise.resolve()
  })
}

afterEach(() => {
  act(() => closeMobileVoicePrompt())
  run.mockReset()
  showToast.mockReset()
})

describe('MobileVoicePromptSheet', () => {
  it('picks the mode from the first words and inserts the rewrite into the composer', async () => {
    const insert = vi.fn()
    const renderer = await open('для агента почини тест', insert)
    expect(run).toHaveBeenCalledWith(
      client,
      expect.objectContaining({ name: 'hq.voice-rewrite' }),
      {
        mode: 'agent',
        text: 'почини тест'
      }
    )
    const field = renderer.root.findByProps({ accessibilityLabel: 'Text to insert' })
    expect(field.props.value).toBe('[agent] готово')
    await press(renderer, 'Insert')
    expect(insert).toHaveBeenCalledWith('[agent] готово')
  })

  it('creates the ClickUp task only on Create, and inserts nothing', async () => {
    const insert = vi.fn()
    const renderer = await open('в кликап голос с телефона', insert)
    expect(run).not.toHaveBeenCalledWith(
      client,
      expect.objectContaining({ name: 'hq.voice-task' }),
      expect.anything()
    )
    await press(renderer, 'Create in ClickUp')
    expect(run).toHaveBeenCalledWith(client, expect.objectContaining({ name: 'hq.voice-task' }), {
      text: '[clickup] готово'
    })
    expect(showToast).toHaveBeenCalledWith('Task created in ClickUp')
    expect(insert).not.toHaveBeenCalled()
  })
})

import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { describe, expect, it, vi } from 'vitest'

const run = vi.hoisted(() => vi.fn())

vi.mock('react-native', () => ({
  Pressable: 'Pressable',
  StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
  Text: 'Text',
  TextInput: 'TextInput',
  View: 'View'
}))
vi.mock('../transport/rpc-operation', () => ({
  runRpcOperation: run,
  defineRpcOperation: (definition: { name: string }) => definition
}))

import type { HqChatWireItem } from '../../../src/shared/hq-chat-wire'
import type { RpcClient } from '../transport/rpc-client'
import { MobileHqChatList, hqChatSessionHref } from './MobileHqChatList'

// oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: runRpcOperation is mocked; the client is never used.
const client = {} as RpcClient

const chat = (over: Partial<HqChatWireItem>): HqChatWireItem => ({
  key: 'k1',
  group: 'needs',
  worktreeId: 'repo::/w',
  paneKey: 'tab-1:leaf',
  executionHostId: 'local',
  projectName: 'orca-custom',
  worktreeName: 'custom',
  title: 'Лента v2',
  preview: 'Which tenant?',
  agentType: 'claude',
  unseen: true,
  sortAt: Date.now() - 60_000,
  color: '#f97316',
  ...over
})

async function render(): Promise<ReactTestRenderer> {
  let renderer: ReactTestRenderer | null = null
  await act(async () => {
    renderer = create(createElement(MobileHqChatList, { client, onOpen: vi.fn() }))
  })
  if (!renderer) {
    throw new Error('list did not render')
  }
  return renderer
}

function texts(renderer: ReactTestRenderer): string[] {
  return renderer.root
    .findAll((node) => node.type === 'Text')
    .map((node) => [node.props.children].flat().join(''))
}

describe('MobileHqChatList', () => {
  it('lists chats in the desktop sections and folds the quiet ones', async () => {
    run.mockResolvedValue({
      publishedAt: 1,
      items: [
        chat({}),
        chat({ key: 'k2', group: 'working', title: 'Reports' }),
        chat({ key: 'k3', group: 'active', title: 'Gate fix', unseen: false }),
        chat({ key: 'k4', group: 'quiet', title: 'Old chat' })
      ]
    })
    const shown = texts(await render())
    expect(shown).toEqual(
      expect.arrayContaining(['Needs you · 1', 'Working · 1', 'Active projects · 1', '▸ Quiet · 1'])
    )
    expect(shown).toContain('Лента v2')
    expect(shown).not.toContain('Old chat')
  })

  it('asks for the Mac window when nothing was published yet', async () => {
    run.mockResolvedValue({ publishedAt: 0, items: [] })
    expect(texts(await render()).join(' ')).toContain('Open Orca+ on the Mac')
  })

  it('opens a chat by its pane, naming only a runtime host', () => {
    expect(hqChatSessionHref('mac', chat({}))).toBe(
      '/h/mac/session/repo%3A%3A%2Fw?name=orca-custom&paneKey=tab-1%3Aleaf'
    )
    expect(hqChatSessionHref('mac', chat({ executionHostId: 'runtime:box' }))).toContain(
      '&executionHost=runtime%3Abox'
    )
    expect(hqChatSessionHref('mac', chat({ paneKey: null }))).toBeNull()
  })
})

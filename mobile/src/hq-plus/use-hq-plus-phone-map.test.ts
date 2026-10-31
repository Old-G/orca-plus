import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { HqChatWireItem } from '../../../src/shared/hq-chat-wire'
import type { RpcClient } from '../transport/rpc-client'
import { useHqPlusPhoneMap, type HqPlusPhoneMap } from './use-hq-plus-phone-map'

const request = vi.hoisted(() => vi.fn())
vi.mock('../session/mobile-session-write-operations', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../session/mobile-session-write-operations')>()
  return { sessionTabClose: { request, interpret: actual.sessionTabClose.interpret } }
})

const CHAT: HqChatWireItem = {
  key: 'c1',
  group: 'working',
  worktreeId: 'wt1',
  paneKey: 'tab-1:leaf',
  executionHostId: null,
  projectName: 'acme-app',
  worktreeName: 'main',
  title: 'Release notes',
  preview: '',
  agentType: 'claude',
  unseen: false,
  sortAt: 1,
  color: null,
  repoId: 'r1'
}
const SPACES = [{ slug: 'acme', name: 'Acme', color: '#3b82f6', repoIds: ['r1'], projects: [] }]

let renderer: ReactTestRenderer | null = null
afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
  request.mockReset()
})

function mount(chats: HqChatWireItem[]): {
  map: () => HqPlusPhoneMap
  reread: (next: HqChatWireItem[]) => void
  notices: string[]
} {
  let latest: HqPlusPhoneMap | null = null
  const notices: string[] = []
  const props = (list: HqChatWireItem[]) => ({
    shown: true,
    // SAFETY: the hook only hands the client to the mocked `sessionTabClose.request`.
    client: {} as RpcClient,
    hostId: 'h1',
    spaces: SPACES,
    room: null,
    items: [],
    waits: [],
    chats: list,
    push: () => {},
    onNotice: (text: string) => notices.push(text),
    onChanged: () => {}
  })
  function Probe(input: ReturnType<typeof props>): null {
    latest = useHqPlusPhoneMap(input)
    return null
  }
  act(() => {
    renderer = create(createElement(Probe, props(chats)))
  })
  return {
    map: () => latest!,
    reread: (next) => act(() => renderer!.update(createElement(Probe, props(next)))),
    notices
  }
}

async function closeWith(probe: ReturnType<typeof mount>, result: unknown): Promise<void> {
  request.mockResolvedValue({ id: 'close', ok: true, result })
  await act(async () => {
    probe.map().closeChat!(CHAT)
  })
}

describe('× on a Map chat (Codex, 31.10)', () => {
  it('keeps a chat the Mac did not confirm closing, so the next read decides', async () => {
    const probe = mount([CHAT])
    await closeWith(probe, { closed: true })
    expect(probe.map().chats.map((chat) => chat.key)).toEqual(['c1'])
    probe.reread([{ ...CHAT }])
    expect(probe.map().chats.map((chat) => chat.key)).toEqual(['c1'])
  })

  it('hides a confirmed close at once and shows the chat again once a read brings it back', async () => {
    const probe = mount([CHAT])
    await closeWith(probe, { closed: true, retirementConfirmed: true })
    expect(probe.map().chats).toEqual([])
    probe.reread([])
    probe.reread([{ ...CHAT }])
    expect(probe.map().chats.map((chat) => chat.key)).toEqual(['c1'])
  })
})

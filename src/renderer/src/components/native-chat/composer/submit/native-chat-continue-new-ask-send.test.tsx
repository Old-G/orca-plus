// Custom build (chat-continue-new, T6 variant B): the ask on send through the real composer pipeline.
import { changePrompt, promptValue } from '../editor/native-chat-prompt-editor.test-support'
// @vitest-environment happy-dom

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as nativeChatAgentProfiles from '../../../../../../shared/native-chat/input/commands/native-chat-agent-profiles'
import type { NativeChatStructuredComposerTransport } from './native-chat-structured-composer-transport'
import type * as RemoteRuntimePtyIdModule from '../../../../../../shared/remote-runtime/remote-runtime-pty-id'

vi.mock('../controls/NativeChatComposerWorkspace', () => ({
  NativeChatComposerWorkspace: () => null
}))

vi.mock('@/i18n/i18n', () => ({
  i18n: { language: 'en' },
  translate: (_key: string, fallback: string, values?: Record<string, string>) =>
    fallback.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => values?.[name] ?? '')
}))
const actions = vi.hoisted((): { sendDisabled: boolean | null } => ({ sendDisabled: null }))

vi.mock('../controls/NativeChatComposerActions', () => ({
  NativeChatComposerActions: (props: { sendDisabled: boolean }) => {
    actions.sendDisabled = props.sendDisabled
    return <div data-testid="composer-actions" />
  }
}))
vi.mock('../pickers/NativeChatAutocompleteMenus', () => ({
  NativeChatMentionMenu: () => null,
  NativeChatPickerMenu: () => null
}))
vi.mock('../../../../store/index', () => {
  const state = {
    dictationState: 'idle',
    settings: { voice: { enabled: false }, nativeChatSessionOptions: {} },
    agentStatusByPaneKey: { get: () => undefined, subscribe: () => () => {} },
    updateSettings: vi.fn(),
    clearNativeChatLaunchDraft: vi.fn(),
    markNativeChatLaunchDraftAdopted: vi.fn()
  }
  const useAppStore = (selector: (value: typeof state) => unknown): unknown => selector(state)
  useAppStore.getState = () => state
  return { useAppStore }
})
vi.mock('@/runtime/hosted-terminals/input/runtime-terminal-input-send', () => ({
  sendRuntimePtyInput: vi.fn()
}))
vi.mock(
  '../../../../../../shared/remote-runtime/remote-runtime-pty-id',
  async (importOriginal) => ({
    ...(await importOriginal<typeof RemoteRuntimePtyIdModule>()),
    isRemoteRuntimePtyId: () => false
  })
)
vi.mock('../../session/terminal/send/native-chat-runtime-send', () => ({
  sendNativeChatMessage: vi.fn(),
  sendNativeChatTypedCommand: vi.fn(),
  sendNativeChatMessageVerified: vi.fn(),
  typeNativeChatCommand: vi.fn(),
  submitNativeChatPrompt: vi.fn()
}))
vi.mock('../../session/terminal/send/native-chat-runtime-image-send', () => ({
  sendNativeChatMessageWithImageAttachments: vi.fn()
}))
vi.mock('../../session/options/terminal/claude-model-switch-confirmation', () => ({
  createClaudeModelSwitchConfirmationObserver: vi.fn()
}))
vi.mock(
  '../../../../../../shared/native-chat/input/commands/native-chat-agent-profiles',
  async (importOriginal) => ({
    ...(await importOriginal<typeof nativeChatAgentProfiles>()),
    getVerifiedNativeChatCommands: () => []
  })
)
vi.mock('../../telemetry/native-chat-telemetry', () => ({
  emitNativeChatMessageSent: vi.fn(),
  emitNativeChatPickerItemAccepted: vi.fn(),
  emitNativeChatPickerOpened: vi.fn(),
  emitNativeChatSendClassified: vi.fn()
}))
vi.mock('../pickers/use-native-chat-skills', () => ({
  useNativeChatSkills: () => ({ status: 'ready', skills: [], error: null, retry: () => {} })
}))
vi.mock('../../../dictation/dictation-control-events', () => ({
  dispatchDictationControl: vi.fn()
}))

import { useMemo, type ReactNode } from 'react'
import { NativeChatComposer } from '../NativeChatComposer'
import { readNativeChatDraftCache } from '../../drafts/native-chat-draft-views'
import {
  NativeChatContinueNewContext,
  type NativeChatContinueNew
} from '../../usage/native-chat-continue-new-context'

const PASS_THROUGH = { handled: false, accepted: false, error: null }

function transport(): NativeChatStructuredComposerTransport {
  return {
    capturePresentation: () => () => true,
    send: vi.fn(() => true),
    dispatchCommand: vi.fn(async () => PASS_THROUGH),
    optionsSurface: {
      getSnapshot: () => [],
      setOption: vi.fn(),
      invokeAction: vi.fn(),
      subscribe: () => () => {}
    },
    optionSnapshot: [],
    onError: vi.fn(),
    runtime: 'local',
    sessionId: 'session-test',
    runtimeEnvironmentId: null
  }
}

let paneCounter = 0

function DueProvider({
  start,
  children
}: {
  start: NativeChatContinueNew['start']
  children: ReactNode
}): React.JSX.Element {
  const offer = useMemo(
    () => ({ usedTokens: 420_000, idleMs: 3 * 60 * 60_000, starting: false, start }),
    [start]
  )
  return (
    <NativeChatContinueNewContext.Provider value={offer}>
      {children}
    </NativeChatContinueNewContext.Provider>
  )
}

function renderDue(
  structured: NativeChatStructuredComposerTransport,
  start: NativeChatContinueNew['start']
): string {
  paneCounter += 1
  render(
    <DueProvider start={start}>
      <NativeChatComposer
        terminalTabId={`tab-${paneCounter}`}
        paneKey={`tab-${paneCounter}:structured`}
        targetPtyId={null}
        agent="claude"
        structuredTransport={structured}
      />
    </DueProvider>
  )
  return `tab-${paneCounter}:structured`
}

function textarea(): HTMLTextAreaElement {
  return screen.getByRole('textbox') as HTMLTextAreaElement
}

async function pressEnter(input: HTMLTextAreaElement): Promise<void> {
  await act(async () => {
    fireEvent.keyDown(input, { key: 'Enter', keyCode: 13, isComposing: false })
  })
}

beforeEach(() => {
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: {
      git: { discoverCommitMessageModels: vi.fn().mockResolvedValue({ success: false }) },
      pty: { getMainBufferSnapshot: vi.fn().mockResolvedValue(null) }
    }
  })
})

afterEach(() => cleanup())

describe('Enter in a chat due for a new one', () => {
  it('asks first and keeps the message in the field', async () => {
    const structured = transport()
    const start = vi.fn<NativeChatContinueNew['start']>(async () => true)
    const pane = renderDue(structured, start)
    const input = textarea()
    changePrompt(input, 'Threshold 300k, go.')
    await pressEnter(input)

    expect(structured.send).not.toHaveBeenCalled()
    expect(start).not.toHaveBeenCalled()
    expect(promptValue(input)).toBe('Threshold 300k, go.')
    expect(readNativeChatDraftCache(pane)).toBe('Threshold 300k, go.')
    expect(screen.getByText('Send here')).toBeTruthy()
  })

  it('sends the message to the new chat on the second Enter and empties the field', async () => {
    const structured = transport()
    const start = vi.fn<NativeChatContinueNew['start']>(async () => true)
    const pane = renderDue(structured, start)
    const input = textarea()
    changePrompt(input, 'Threshold 300k, go.')
    await pressEnter(input)
    await pressEnter(input)

    expect(start).toHaveBeenCalledWith('Threshold 300k, go.')
    expect(structured.send).not.toHaveBeenCalled()
    expect(promptValue(input)).toBe('')
    expect(readNativeChatDraftCache(pane)).toBe('')
    expect(screen.queryByText('Send here')).toBeNull()
  })

  it('gives the message back when the new chat does not start', async () => {
    const structured = transport()
    const start = vi.fn<NativeChatContinueNew['start']>(async () => false)
    renderDue(structured, start)
    const input = textarea()
    changePrompt(input, 'hello')
    await pressEnter(input)
    await pressEnter(input)

    expect(start).toHaveBeenCalledWith('hello')
    expect(promptValue(input)).toBe('hello')
  })

  it('«Send here» sends the message to this chat', async () => {
    const structured = transport()
    const start = vi.fn<NativeChatContinueNew['start']>(async () => true)
    renderDue(structured, start)
    const input = textarea()
    changePrompt(input, 'hello')
    await pressEnter(input)
    await act(async () => {
      fireEvent.click(screen.getByText('Send here'))
    })

    expect(structured.send).toHaveBeenCalledWith('hello', [])
    expect(start).not.toHaveBeenCalled()
    expect(screen.queryByText('Send here')).toBeNull()
  })

  it('Esc hides the question and the next Enter asks again', async () => {
    const structured = transport()
    const start = vi.fn<NativeChatContinueNew['start']>(async () => true)
    renderDue(structured, start)
    const input = textarea()
    changePrompt(input, 'hello')
    await pressEnter(input)
    await act(async () => {
      fireEvent.keyDown(input, { key: 'Escape' })
    })
    expect(screen.queryByText('Send here')).toBeNull()
    await pressEnter(input)

    expect(start).not.toHaveBeenCalled()
    expect(structured.send).not.toHaveBeenCalled()
    expect(screen.getByText('Send here')).toBeTruthy()
  })
})

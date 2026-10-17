// @vitest-environment happy-dom

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  insertText: vi.fn(),
  voiceRewrite: vi.fn(async ({ mode }: { mode: string }) => ({
    ok: true,
    text: `[${mode}] готово`
  })),
  saveIdea: vi.fn(async () => ({ ok: true, path: 'ideas/x.md' })),
  createVoiceTask: vi.fn(async () => ({ ok: true, url: 'https://app.clickup.com/t/1' })),
  settings: { hqVoicePromptsEnabled: true }
}))

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('@/components/dictation/dictation-insertion-target', () => ({
  insertText: mocks.insertText
}))
vi.mock('@/store', () => ({ useAppStore: { getState: () => ({ settings: mocks.settings }) } }))

import { HqVoicePreviewDialog } from './HqVoicePreviewDialog'
import { closeHqVoicePreview, offerHqVoicePreview } from './hq-voice-preview'

const target = {
  kind: 'text' as const,
  element: document.body.appendChild(document.createElement('textarea'))
}

beforeEach(() => {
  vi.stubGlobal('api', {
    hqProjects: {
      voiceRewrite: mocks.voiceRewrite,
      saveIdea: mocks.saveIdea,
      createVoiceTask: mocks.createVoiceTask
    }
  })
  mocks.settings.hqVoicePromptsEnabled = true
})

afterEach(() => {
  act(() => closeHqVoicePreview())
  cleanup()
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})

describe('HqVoicePreviewDialog', () => {
  it('picks the mode from the first words, rewrites without them, and inserts the edited result', async () => {
    render(<HqVoicePreviewDialog />)
    act(() => offerHqVoicePreview('Для агента, почини тест', target))
    await waitFor(() => expect(screen.getByDisplayValue('[agent] готово')).toBeTruthy())
    expect(mocks.voiceRewrite).toHaveBeenCalledWith({ mode: 'agent', text: 'почини тест' })
    fireEvent.change(screen.getByDisplayValue('[agent] готово'), { target: { value: 'правка' } })
    fireEvent.click(screen.getByRole('button', { name: 'Insert' }))
    await waitFor(() => expect(mocks.insertText).toHaveBeenCalledWith('правка', target))
    expect(document.activeElement).toBe(target.element)
  })

  it('starts on the text as said and saves an idea to HQ', async () => {
    render(<HqVoicePreviewDialog />)
    act(() => offerHqVoicePreview('сводка почты утром', target))
    expect(screen.getByDisplayValue('сводка почты утром')).toBeTruthy()
    expect(mocks.voiceRewrite).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('radio', { name: 'Idea' }))
    await waitFor(() => expect(screen.getByDisplayValue('[idea] готово')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Save to HQ ideas' }))
    await waitFor(() => expect(mocks.saveIdea).toHaveBeenCalledWith({ text: '[idea] готово' }))
  })

  it('creates the ClickUp task only when Create is pressed', async () => {
    render(<HqVoicePreviewDialog />)
    act(() => offerHqVoicePreview('в кликап голос из окна', target))
    await waitFor(() => expect(screen.getByDisplayValue('[clickup] готово')).toBeTruthy())
    expect(mocks.createVoiceTask).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Create in ClickUp' }))
    await waitFor(() =>
      expect(mocks.createVoiceTask).toHaveBeenCalledWith({ text: '[clickup] готово' })
    )
    await waitFor(() => expect(screen.queryByText('Voice prompt')).toBeNull())
  })

  it('opens nothing while voice prompts are off', () => {
    mocks.settings.hqVoicePromptsEnabled = false
    render(<HqVoicePreviewDialog />)
    act(() => offerHqVoicePreview('что-то', target))
    expect(screen.queryByText('Voice prompt')).toBeNull()
  })
})

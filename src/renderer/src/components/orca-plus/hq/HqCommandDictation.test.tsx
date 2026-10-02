// @vitest-environment happy-dom

import { createRef } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DICTATION_CONTROL_EVENT } from '../../dictation/dictation-control-events'

type VoiceSettings = { enabled: boolean; sttModel: string; dictationMode: 'toggle' | 'hold' }

const mocks = vi.hoisted(() => {
  const toggleVoice = (): VoiceSettings | null => ({
    enabled: true,
    sttModel: 'model',
    dictationMode: 'toggle'
  })
  return { voice: toggleVoice(), dictationState: 'idle' }
})

vi.mock('@/i18n/i18n', () => ({ translate: (_key: string, fallback: string) => fallback }))
vi.mock('@/store', () => {
  const state = () => ({
    dictationState: mocks.dictationState,
    settings: { voice: mocks.voice }
  })
  const useAppStore = (selector: (s: ReturnType<typeof state>) => unknown) => selector(state())
  useAppStore.getState = state
  return { useAppStore }
})

import { HqCommandDictation } from './HqCommandDictation'

const controls: string[] = []
const record = (event: Event): void => {
  if (event instanceof CustomEvent) {
    controls.push(String(event.detail))
  }
}

function renderWithBox(disabled = false): HTMLTextAreaElement {
  const ref = createRef<HTMLTextAreaElement>()
  render(
    <div>
      <textarea ref={ref} aria-label="Command" />
      <HqCommandDictation textareaRef={ref} disabled={disabled} />
    </div>
  )
  return screen.getByLabelText('Command')
}

beforeEach(() => {
  document.addEventListener(DICTATION_CONTROL_EVENT, record)
})

afterEach(() => {
  document.removeEventListener(DICTATION_CONTROL_EVENT, record)
  cleanup()
  controls.length = 0
  mocks.voice = { enabled: true, sttModel: 'model', dictationMode: 'toggle' }
  mocks.dictationState = 'idle'
})

describe('HqCommandDictation', () => {
  it('focuses the command box and toggles dictation on click', () => {
    const box = renderWithBox()
    fireEvent.click(screen.getByRole('button', { name: 'Dictate the command' }))
    expect(controls).toEqual(['toggle'])
    expect(document.activeElement).toBe(box)
  })

  it('starts on press and stops on release in hold mode', () => {
    mocks.voice = { enabled: true, sttModel: 'model', dictationMode: 'hold' }
    renderWithBox()
    const button = screen.getByRole('button', { name: 'Dictate the command' })
    fireEvent.pointerDown(button)
    fireEvent.pointerUp(button)
    expect(controls).toEqual(['start', 'stop'])
  })

  it('is off, and says where to turn it on, while voice dictation is not set up', () => {
    mocks.voice = null
    renderWithBox()
    const button = screen.getByRole('button', {
      name: 'Turn on voice dictation in Settings → Voice'
    })
    expect(button.hasAttribute('disabled')).toBe(true)
  })

  it('offers Stop while dictation runs', () => {
    mocks.dictationState = 'listening'
    renderWithBox()
    expect(screen.getByRole('button', { name: 'Stop dictation' })).toBeTruthy()
  })
})

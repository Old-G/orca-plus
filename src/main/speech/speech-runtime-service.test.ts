import { afterEach, describe, expect, it, vi } from 'vitest'
import { getDefaultVoiceSettings } from '../../shared/constants'
import type { VoiceSettings } from '../../shared/speech-types'
import type { ModelManager } from './model-manager'
import type { SttService } from './stt-service'
import { getSpeechSttService, setSpeechServiceFactories } from './speech-runtime-service'

describe('getSpeechSttService dictation language', () => {
  afterEach(() => setSpeechServiceFactories(null))

  it('reads the dictation language from the current settings on every call', () => {
    let voice: VoiceSettings = getDefaultVoiceSettings()
    let readLanguage: (() => string | undefined) | null = null
    setSpeechServiceFactories({
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the factory under test never touches the model manager.
      createModelManager: () => ({}) as ModelManager,
      createSttService: vi.fn((_models, reader: () => string | undefined) => {
        readLanguage = reader
        // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: only the injected reader is inspected.
        return {} as SttService
      })
    })
    getSpeechSttService({ getSettings: () => ({ voice }) })
    const read = (): string | undefined => readLanguage?.()

    // Why: upstream's stored `language: 'en'` must not force English.
    expect(voice.language).toBe('en')
    expect(read()).toBeUndefined()
    voice = { ...voice, dictationLanguage: 'ru' }
    expect(read()).toBe('ru')
    voice = { ...voice, dictationLanguage: 'auto' }
    expect(read()).toBeUndefined()
  })
})

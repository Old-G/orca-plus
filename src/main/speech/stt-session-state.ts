import type { Worker } from 'node:worker_threads'
import type { ModelManager } from './model-manager'
import type { OpenAiTranscriptionSession } from './openai-transcription-client'
import type { SttEventSink } from './stt-service'

export type StopInFlight = {
  worker: Worker
  owner: string
  promise: Promise<void>
}

export type SttSessionState = {
  worker: Worker | null
  cloudSession: OpenAiTranscriptionSession | null
  modelManager: ModelManager
  /** Custom build (dictation-language): ISO code for cloud transcription, undefined = detect. */
  readLanguage: () => string | undefined
  activeModelId: string | null
  activeHotwordsFilePath: string | undefined
  activeOwner: string | null
  startingOwner: string | null
  startingModelId: string | null
  starting: boolean
  canceledOwners: Set<string>
  eventSink: SttEventSink | null
  idleTeardownTimer: NodeJS.Timeout | null
  stopInFlight: StopInFlight | null
  stopping: boolean
  cleanupWorkerLifecycleListeners: (() => void) | null
}

export function createSttSessionState(
  modelManager: ModelManager,
  readLanguage: () => string | undefined = () => undefined
): SttSessionState {
  return {
    worker: null,
    cloudSession: null,
    modelManager,
    readLanguage,
    activeModelId: null,
    activeHotwordsFilePath: undefined,
    activeOwner: null,
    startingOwner: null,
    startingModelId: null,
    starting: false,
    canceledOwners: new Set(),
    eventSink: null,
    idleTeardownTimer: null,
    stopInFlight: null,
    stopping: false,
    cleanupWorkerLifecycleListeners: null
  }
}

// Custom build (hq-read-aloud): the natural voices «Read aloud» offers, and what a synthesis returns.
export const HQ_READ_ALOUD_NEURAL_VOICES = [
  'nova',
  'coral',
  'alloy',
  'sage',
  'onyx',
  'echo'
] as const
export type HqReadAloudNeuralVoice = (typeof HQ_READ_ALOUD_NEURAL_VOICES)[number]

/** `no-key`: no OpenAI key on this Mac, so the system voice reads instead. */
export type HqReadAloudSpeechResult = { ok: true; audio: Uint8Array } | { ok: false; error: string }

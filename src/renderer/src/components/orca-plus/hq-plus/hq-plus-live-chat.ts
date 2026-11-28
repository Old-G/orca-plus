// Custom build (A8, 28.11): asks the router's registry for the open chat already carrying a card's work.
import type { HqPlusTakeHint } from './hq-plus-take-hint'
import { hqPlusCall } from './use-hq-plus-data'

/** The chat the card's work is in now (handoffs followed), or null — also when the call fails. */
export async function hqPlusLiveChatOf(hint: HqPlusTakeHint | null): Promise<string | null> {
  if (!hint || (!hint.sessionId && !hint.key)) {
    return null
  }
  const result = await hqPlusCall('hq.liveChat', {
    ...(hint.key ? { key: hint.key } : {}),
    ...(hint.sessionId ? { sessionId: hint.sessionId } : {})
  }).catch(() => null)
  const found = result?.ok ? Reflect.get(Object(result.result), 'sessionId') : null
  return typeof found === 'string' ? found : null
}

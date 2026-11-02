import { getOptionalStringFlag } from '../arguments/flags'
import { RuntimeClientError } from '../runtime/types'

// Custom build (automations-chat-model, owner 02.11): `--surface chat|terminal` is the UI's «Open in».
export function surfacePatch(
  flags: Map<string, string | boolean>
): { launchSetupPatch: { surface: 'chat' | 'terminal' } } | Record<string, never> {
  const surface = getOptionalStringFlag(flags, 'surface')
  if (surface === undefined) {
    return {}
  }
  if (surface !== 'chat' && surface !== 'terminal') {
    throw new RuntimeClientError('invalid_argument', '--surface must be chat or terminal')
  }
  return { launchSetupPatch: { surface } }
}

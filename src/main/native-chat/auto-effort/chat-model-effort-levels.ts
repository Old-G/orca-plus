// Custom build (chat-auto-effort): the effort levels a chat's model offers, from the saved model list,
// so a pick is never handed to a model with no effort control (a first message would start under it).
import type { AgentSessionModelOption } from '../../../shared/agent-session-wire'
import type { AgentSessionRecord } from '../../../shared/agent-session-record'
import { agentModelCatalogStore } from '../agent-model-catalog/agent-model-catalog-store'
import { agentModelCatalogFingerprintForRecord } from '../agent-model-catalog/agent-model-catalog-fingerprint'

/** Null when the list does not identify the model: no evidence, so nothing is refused. */
export function modelEffortLevels(
  models: readonly AgentSessionModelOption[],
  modelId: string | undefined
): ReadonlySet<string> | null {
  const model = modelId
    ? models.find((entry) => entry.id === modelId)
    : models.find((entry) => entry.isDefault)
  return model ? new Set(model.efforts.map((choice) => choice.value)) : null
}

/** `modelId` is the model the message itself switches to, else the chat's. */
export function chatModelEffortLevels(
  record: Pick<AgentSessionRecord, 'provider' | 'accountHome' | 'location' | 'options'> | null,
  modelId: string | undefined
): ReadonlySet<string> | null {
  if (!record) {
    return null
  }
  const entry = agentModelCatalogStore.get(agentModelCatalogFingerprintForRecord(record))
  return entry ? modelEffortLevels(entry.models, modelId ?? record.options?.model) : null
}

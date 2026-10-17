// Custom build (hq-mobile): the calls the phone's HQ page makes to the Mac, as typed operations.
import {
  HqDraftReplySchema,
  HqRequestsReplySchema,
  HqWriteReplySchema
} from '../../../src/shared/hq-requests-reply'
import { z } from 'zod'
import { readHqPulse, type HqPulse } from '../../../src/shared/hq-pulse-snapshot'
import { defineRpcOperation } from '../transport/rpc-operation'
import type { RpcCompatibleReader } from '../transport/rpc-operation-contract'
import { rpcResultVariant } from '../transport/rpc-operation-result-reader'

export const hqRequestsRead = defineRpcOperation({
  name: 'hq.requests',
  method: 'hqProjects.slackDrafts',
  acceptance: 'require-result-or-throw',
  barrier: 'on-settle',
  read: rpcResultVariant('hq-requests', HqRequestsReplySchema)
})

export const hqRequestSkip = defineRpcOperation({
  name: 'hq.request-skip',
  method: 'hqProjects.rejectSlackDraft',
  acceptance: 'require-result-or-throw',
  barrier: 'on-settle',
  read: rpcResultVariant('hq-request-skip', HqWriteReplySchema)
})

export const hqRequestRestore = defineRpcOperation({
  name: 'hq.request-restore',
  method: 'hqProjects.restoreSlackDraft',
  acceptance: 'require-result-or-throw',
  barrier: 'on-settle',
  read: rpcResultVariant('hq-request-restore', HqWriteReplySchema)
})

/** Do / Just reply on a Slack request run in the Mac's window, where the bell's code lives. */
export const hqRequestOnDesktop = defineRpcOperation({
  name: 'hq.request-on-desktop',
  method: 'hqProjects.runRequestOnDesktop',
  acceptance: 'require-result-or-throw',
  barrier: 'on-settle',
  read: rpcResultVariant('hq-request-on-desktop', HqWriteReplySchema)
})

export const hqClickUpReplyDraft = defineRpcOperation({
  name: 'hq.clickup-reply-draft',
  method: 'hqProjects.draftClickUpReply',
  acceptance: 'require-result-or-throw',
  barrier: 'on-settle',
  read: rpcResultVariant('hq-clickup-reply-draft', HqDraftReplySchema)
})

export const hqClickUpReplySend = defineRpcOperation({
  name: 'hq.clickup-reply-send',
  method: 'hqProjects.sendClickUpReply',
  acceptance: 'require-result-or-throw',
  barrier: 'on-settle',
  read: rpcResultVariant('hq-clickup-reply-send', HqWriteReplySchema)
})

const pulseReader: RpcCompatibleReader<unknown, 'hq-pulse', HqPulse> = (raw) => {
  const pulse = readHqPulse(raw)
  return pulse
    ? {
        compatible: true,
        variant: 'hq-pulse',
        value: pulse,
        salvage: { droppedPaths: [], droppedCount: 0 }
      }
    : { compatible: false, issues: [{ path: '', message: 'not a pulse snapshot' }] }
}

/** People, open waitings and notes, and decisions — the Mac's pulse database. */
export const hqPulseRead = defineRpcOperation({
  name: 'hq.pulse',
  method: 'pulse.snapshot',
  acceptance: 'require-result-or-throw',
  barrier: 'on-settle',
  read: pulseReader
})

export const hqPersonUpsert = defineRpcOperation({
  name: 'hq.person-upsert',
  method: 'pulse.upsertPerson',
  acceptance: 'require-result-or-throw',
  barrier: 'on-settle',
  read: rpcResultVariant('hq-person', z.object({ id: z.string() }).passthrough())
})

export const hqWaitingAdd = defineRpcOperation({
  name: 'hq.waiting-add',
  method: 'pulse.addWaiting',
  acceptance: 'require-result-or-throw',
  barrier: 'on-settle',
  read: rpcResultVariant('hq-waiting-added', z.unknown())
})

export const hqWaitingClose = defineRpcOperation({
  name: 'hq.waiting-close',
  method: 'pulse.closeWaiting',
  acceptance: 'require-result-or-throw',
  barrier: 'on-settle',
  read: rpcResultVariant('hq-waiting-closed', z.unknown())
})

export const hqInboxRead = defineRpcOperation({
  name: 'hq.inbox',
  method: 'pulse.listInbox',
  acceptance: 'require-result-or-throw',
  barrier: 'on-settle',
  read: rpcResultVariant('hq-inbox', z.array(z.unknown()))
})

export const hqInboxMarkRead = defineRpcOperation({
  name: 'hq.inbox-mark-read',
  method: 'pulse.markInboxRead',
  acceptance: 'require-result-or-throw',
  barrier: 'on-settle',
  read: rpcResultVariant('hq-inbox-read', z.unknown())
})

/** A bell item's button, pressed in the Mac's window; the Mac refuses approvals. */
export const hqBellActionOnDesktop = defineRpcOperation({
  name: 'hq.bell-action-on-desktop',
  method: 'hqProjects.runBellActionOnDesktop',
  acceptance: 'require-result-or-throw',
  barrier: 'on-settle',
  read: rpcResultVariant('hq-bell-action-on-desktop', HqWriteReplySchema)
})

// Custom build (hq-voice-prompts): the phone's dictation goes through the Mac's voice prompts.
export const hqSettingsRead = defineRpcOperation({
  name: 'hq.settings',
  method: 'hqProjects.settings',
  acceptance: 'require-result-or-throw',
  barrier: 'on-settle',
  read: rpcResultVariant(
    'hq-settings',
    z.object({ hqVoicePromptsEnabled: z.boolean().optional() }).passthrough()
  )
})

export const hqVoiceRewrite = defineRpcOperation({
  name: 'hq.voice-rewrite',
  method: 'hqProjects.voiceRewrite',
  acceptance: 'require-result-or-throw',
  barrier: 'on-settle',
  read: rpcResultVariant('hq-voice-rewrite', HqDraftReplySchema)
})

export const hqVoiceIdea = defineRpcOperation({
  name: 'hq.voice-idea',
  method: 'hqProjects.saveIdea',
  acceptance: 'require-result-or-throw',
  barrier: 'on-settle',
  read: rpcResultVariant('hq-voice-idea', HqWriteReplySchema)
})

export const hqVoiceTask = defineRpcOperation({
  name: 'hq.voice-task',
  method: 'hqProjects.createVoiceTask',
  acceptance: 'require-result-or-throw',
  barrier: 'on-settle',
  read: rpcResultVariant('hq-voice-task', HqWriteReplySchema)
})

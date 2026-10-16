// Custom build (hq-mobile): the calls the phone's HQ page makes to the Mac, as typed operations.
import {
  HqDraftReplySchema,
  HqRequestsReplySchema,
  HqWriteReplySchema
} from '../../../src/shared/hq-requests-reply'
import { defineRpcOperation } from '../transport/rpc-operation'
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

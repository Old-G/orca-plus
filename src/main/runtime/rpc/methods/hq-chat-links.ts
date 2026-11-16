// Custom build (hq-plus-chat-tree, owner 04.11): the chat a launch started, under the chat that ran it,
// and every link for HQ+'s «By work» tree. A launch from no chat links nothing.
import { defineMethod } from '../core'
import {
  HqChatLinksParams,
  HqLinkChatParams,
  HqReassignParams
} from '../../../../shared/rpc-contract/hq-journal-params'
import { getHqLeadReassign } from '../../../hq-journal/hq-lead-reassign'

export const HQ_CHAT_LINK_METHODS = [
  defineMethod({
    name: 'hq.linkChat',

    permission: 'workspace',
    params: HqLinkChatParams,
    handler: async (params, { runtime }) => ({
      linked: params.callerSessionId
        ? runtime.pulseChats().link({
            sessionId: params.sessionId,
            parentSessionId: params.callerSessionId,
            via: 'launch',
            at: Date.now()
          })
        : false
    })
  }),
  defineMethod({
    name: 'hq.chatLinks',

    permission: 'workspace',
    params: HqChatLinksParams,
    handler: async (_params, { runtime }) => runtime.pulseChats().list()
  }),
  // Custom build (hq-lead-reassign): `orca hq reassign` — a Lead's chats go to another chat.
  defineMethod({
    name: 'hq.reassign',

    permission: 'workspace',
    params: HqReassignParams,
    handler: async ({ callerSessionId, callerWorktreeId, callerCwd, ...request }) => {
      const service = getHqLeadReassign()
      if (!service) {
        throw new Error('Lead changes are not available on this host.')
      }
      return service.reassign(
        { sessionId: callerSessionId, worktreeId: callerWorktreeId, cwd: callerCwd },
        request
      )
    }
  })
]

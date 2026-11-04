// Custom build (hq-plus-chat-tree, owner 04.11): the chat a launch started, under the chat that ran it,
// and every link for HQ+'s «By work» tree. A launch from no chat links nothing.
import { defineMethod } from '../core'
import {
  HqChatLinksParams,
  HqLinkChatParams
} from '../../../../shared/rpc-contract/hq-journal-params'

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
  })
]

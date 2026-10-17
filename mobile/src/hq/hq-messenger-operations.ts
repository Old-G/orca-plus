// Custom build (hq-mobile-messenger): the Mac calls behind the phone's HQ messenger — the chat list
// the desktop window publishes, the Feed, the Reports with their decisions.
import { z } from 'zod'
import { HqChatWireListSchema } from '../../../src/shared/hq-chat-wire'
import { HqFeedItemSchema } from '../../../src/shared/hq-feed'
import { HqReportSchema } from '../../../src/shared/hq-reports'
import { HqWriteReplySchema } from '../../../src/shared/hq-requests-reply'
import { defineRpcOperation } from '../transport/rpc-operation'
import { rpcResultVariant } from '../transport/rpc-operation-result-reader'

export const hqChatListRead = defineRpcOperation({
  name: 'hq.chat-list',
  method: 'hqProjects.chatList',
  acceptance: 'require-result-or-throw',
  barrier: 'on-settle',
  read: rpcResultVariant('hq-chat-list', HqChatWireListSchema)
})

export const hqFeedRead = defineRpcOperation({
  name: 'hq.feed',
  method: 'pulse.feed',
  acceptance: 'require-result-or-throw',
  barrier: 'on-settle',
  read: rpcResultVariant('hq-feed', z.object({ items: z.array(HqFeedItemSchema) }))
})

export const hqReportsRead = defineRpcOperation({
  name: 'hq.reports',
  method: 'hqProjects.reports',
  acceptance: 'require-result-or-throw',
  barrier: 'on-settle',
  read: rpcResultVariant(
    'hq-reports',
    z.union([
      z.object({ ok: z.literal(true), reports: z.array(HqReportSchema) }),
      z.object({ ok: z.literal(false), error: z.string() })
    ])
  )
})

export const hqWikiPageRead = defineRpcOperation({
  name: 'hq.wiki-page',
  method: 'hqProjects.wikiPage',
  acceptance: 'require-result-or-throw',
  barrier: 'on-settle',
  read: rpcResultVariant(
    'hq-wiki-page',
    z.union([
      z.object({ ok: z.literal(true), markdown: z.string() }),
      z.object({ ok: z.literal(false), error: z.string() })
    ])
  )
})

/** The decisions start an HQ chat in the Mac's window, where HQ's chats live. */
export const hqReportDecisions = defineRpcOperation({
  name: 'hq.report-decisions',
  method: 'hqProjects.reportDecisionsOnDesktop',
  acceptance: 'require-result-or-throw',
  barrier: 'on-settle',
  read: rpcResultVariant('hq-report-decisions', HqWriteReplySchema)
})

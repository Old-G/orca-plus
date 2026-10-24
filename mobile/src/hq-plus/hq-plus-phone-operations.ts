// Custom build (hq-plus-phone): the Mac calls behind HQ+ on the phone — the same reads the desktop's
// HQ+ makes (its feed, the week's work), a reply into a thread, a card marked done, a question for the
// Ask HQ chat and a page opened in the Orca browser. Approvals are not among them: they stay on the Mac.
import { z } from 'zod'
import type { HqFeedResult, HqPlusScreenStats } from '../../../src/shared/hq-plus-screen'
import { isHqFeed, isHqScreenStats } from '../../../src/shared/hq-plus-rpc-readers'
import { HqWriteReplySchema } from '../../../src/shared/hq-requests-reply'
import { defineRpcOperation } from '../transport/rpc-operation'
import type { RpcCompatibleReader } from '../transport/rpc-operation-contract'
import { rpcResultVariant } from '../transport/rpc-operation-result-reader'

function guarded<Variant extends string, Value>(
  variant: Variant,
  guard: (value: unknown) => value is Value
): RpcCompatibleReader<unknown, Variant, Value> {
  return (raw) =>
    guard(raw)
      ? { compatible: true, variant, value: raw, salvage: { droppedPaths: [], droppedCount: 0 } }
      : { compatible: false, issues: [{ path: '', message: `not ${variant}` }] }
}

export const hqPlusFeedRead = defineRpcOperation({
  name: 'hq-plus.feed',
  method: 'hq.feed',
  acceptance: 'require-result-or-throw',
  barrier: 'on-settle',
  read: guarded<'hq-plus-feed', HqFeedResult>('hq-plus-feed', isHqFeed)
})

export const hqPlusStatsRead = defineRpcOperation({
  name: 'hq-plus.screen-stats',
  method: 'hq.screenStats',
  acceptance: 'require-result-or-throw',
  barrier: 'on-settle',
  read: guarded<'hq-plus-stats', HqPlusScreenStats>('hq-plus-stats', isHqScreenStats)
})

/** The owner's words into a thread, as the desktop's card and composer send them. */
export const hqPlusChatSend = defineRpcOperation({
  name: 'hq-plus.chat-send',
  method: 'chat.send',
  acceptance: 'require-result-or-throw',
  barrier: 'on-settle',
  read: rpcResultVariant('hq-plus-chat-sent', z.unknown())
})

/** Custom build (hq-closed-loop): the owner's answer on a background job's card. */
export const hqPlusJobReply = defineRpcOperation({
  name: 'hq-plus.job-reply',
  method: 'hq.jobReply',
  acceptance: 'require-result-or-throw',
  barrier: 'on-settle',
  read: rpcResultVariant('hq-plus-job-replied', z.unknown())
})

/** «Got it», «Done» and a reply's words on a bell card; the Mac refuses approval cards. */
export const hqPlusMarkDone = defineRpcOperation({
  name: 'hq-plus.mark-done',
  method: 'pulse.markInboxDone',
  acceptance: 'require-result-or-throw',
  barrier: 'on-settle',
  read: rpcResultVariant('hq-plus-marked-done', z.unknown())
})

export const hqPlusAskHq = defineRpcOperation({
  name: 'hq-plus.ask-hq',
  method: 'hqProjects.askHqOnDesktop',
  acceptance: 'require-result-or-throw',
  barrier: 'on-settle',
  read: rpcResultVariant('hq-plus-ask-hq', HqWriteReplySchema)
})

const SettingsSchema = z.object({ hqPath: z.string().nullable().optional() }).passthrough()

/** Where HQ lives on the Mac: the caller of a thread message, and the workspace a link opens in. */
export const hqPlusSettingsRead = defineRpcOperation({
  name: 'hq-plus.settings',
  method: 'settings.get',
  acceptance: 'require-result-or-throw',
  barrier: 'on-settle',
  read: rpcResultVariant('hq-plus-settings', z.object({ settings: SettingsSchema }).passthrough())
})

export const hqPlusWorktreesRead = defineRpcOperation({
  name: 'hq-plus.worktrees',
  method: 'worktree.ps',
  acceptance: 'require-result-or-throw',
  barrier: 'on-settle',
  read: rpcResultVariant(
    'hq-plus-worktrees',
    z
      .object({
        worktrees: z.array(
          z.object({ worktreeId: z.string(), path: z.string(), repo: z.string() }).passthrough()
        )
      })
      .passthrough()
  )
})

/** A page in the HQ workspace's Orca browser, which the phone's session screen streams. */
export const hqPlusBrowserOpen = defineRpcOperation({
  name: 'hq-plus.browser-open',
  method: 'browser.tabCreate',
  acceptance: 'require-result-or-throw',
  barrier: 'on-settle',
  read: rpcResultVariant('hq-plus-browser-opened', z.unknown())
})

/** A Mac too old for HQ+ on the phone answers that it has no such method, or that phones may not. */
export function isHqPlusMacTooOld(error: unknown): boolean {
  const code = typeof error === 'object' && error !== null ? Reflect.get(error, 'code') : null
  const message = error instanceof Error ? error.message : String(error)
  return (
    code === 'method_not_found' ||
    code === 'forbidden' ||
    /method_not_found|unknown method|not available to mobile|forbidden/i.test(message)
  )
}

/** HQ's project pages, for the Graph's relations between projects. */
export const hqPlusPagesRead = defineRpcOperation({
  name: 'hq-plus.pages',
  method: 'hqProjects.list',
  acceptance: 'require-result-or-throw',
  barrier: 'on-settle',
  read: rpcResultVariant(
    'hq-plus-pages',
    z.union([
      z.object({
        ok: z.literal(true),
        pages: z.array(z.object({ slug: z.string(), relations: z.array(z.string()) }).passthrough())
      }),
      z.object({ ok: z.literal(false), error: z.string() })
    ])
  )
})

// Custom build (hq-plus-chat-tree, owner 04.11): the chat a launch started, under the chat that ran it,
// and every link for HQ+'s «By work» tree. A launch from no chat links nothing.
import { defineMethod } from '../core'
import {
  HqChatLinksParams,
  HqHandoffClaimParams,
  HqLinkChatParams,
  HqReassignParams,
  HqTaskLockParams
} from '../../../../shared/rpc-contract/hq-journal-params'
import { getHqLeadReassign } from '../../../hq-journal/hq-lead-reassign'
import { getClaudeHandoffClaims } from '../../../claude-handoff/claude-handoff-claims'
import { getHqThreads } from '../../../hq-journal/hq-journal-threads'
import { getHqTaskLock } from '../../../hq-journal/hq-task-lock'

export const HQ_CHAT_LINK_METHODS = [
  defineMethod({
    name: 'hq.linkChat',

    permission: 'workspace',
    params: HqLinkChatParams,
    handler: async (params, { runtime }) => {
      const caller = params.callerSessionId
      if (!caller) {
        return { linked: false }
      }
      // Custom build (hq-handoff-parked, T7 25.11): a chat that started its own handoff's successor hands
      // it its thread, as Orca+'s own start does — the address, role, open questions and waitings — so
      // what is sent to the old chat reaches the new one and the old one is parked.
      if (params.handoff === true && params.sessionId !== caller) {
        // Custom build (hq-handoff-once, owner 27.11): Orca+'s own start sees this one is under way.
        getClaudeHandoffClaims().started(caller, params.sessionId)
        if (getHqThreads()?.handoff(caller, params.sessionId) !== true) {
          console.warn(
            `[hq-chat-links] handoff ${caller} → ${params.sessionId} not recorded: HQ+ is off or the old chat is unknown`
          )
        }
        try {
          runtime.pulseMoveOpenWaitingsToChat(caller, params.sessionId)
        } catch (error) {
          console.warn('[hq-chat-links] moving waitings to the new chat failed:', error)
        }
      }
      return {
        linked: runtime.pulseChats().link({
          sessionId: params.sessionId,
          parentSessionId: caller,
          via: 'launch',
          at: Date.now()
        })
      }
    }
  }),
  defineMethod({
    name: 'hq.chatLinks',

    permission: 'workspace',
    params: HqChatLinksParams,
    handler: async (_params, { runtime }) => runtime.pulseChats().list()
  }),
  // Custom build (hq-handoff-auto, owner 24.11): one handoff, one new chat.
  defineMethod({
    name: 'hq.handoffClaim',

    permission: 'workspace',
    params: HqHandoffClaimParams,
    handler: async ({ callerSessionId }) =>
      callerSessionId
        ? getClaudeHandoffClaims().claimForAgent(callerSessionId)
        : { taken: false as const }
  }),
  // Custom build (hq-task-lock, A3): one open chat per plan row; `orca agent launch` claims, then binds.
  defineMethod({
    name: 'hq.taskLock',

    permission: 'workspace',
    params: HqTaskLockParams,
    handler: async ({ action, plan, row, ticket, sessionId, callerSessionId }) => {
      const lock = getHqTaskLock()
      if (!lock) {
        throw new Error('Task locks are not available on this host.')
      }
      if (action === 'claim') {
        return lock.claim({ plan, row, callerSessionId: callerSessionId ?? null })
      }
      if (!ticket) {
        throw new Error('A ticket from the claim is required.')
      }
      if (action === 'release') {
        return lock.release({ plan, row, ticket })
      }
      if (!sessionId) {
        throw new Error('The started chat’s session id is required.')
      }
      return lock.bind({ plan, row, ticket, sessionId })
    }
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

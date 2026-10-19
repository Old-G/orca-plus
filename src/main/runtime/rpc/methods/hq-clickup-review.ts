// Custom build (hq-clickup-review): «Разобрать» over RPC — a paired client starts the chat, and the
// chat's `orca pulse review reply` hands its draft comment back to the card.
import { defineMethod } from '../core'
import {
  HqClickUpReviewReplyParams,
  HqSlackDraftRefParams
} from '../../../../shared/rpc-contract/hq-projects-params'
import {
  getHqClickUpReviewService,
  type HqClickUpReviewService
} from '../../../hq-today/hq-clickup-review'

function service(): HqClickUpReviewService {
  const provided = getHqClickUpReviewService()
  if (!provided) {
    throw new Error('HQ is not available on this host.')
  }
  return provided
}

export const HQ_CLICKUP_REVIEW_METHODS = [
  defineMethod({
    name: 'hqProjects.startClickUpReview',

    permission: 'workspace',
    params: HqSlackDraftRefParams,
    handler: async (params) => service().start(params.id)
  }),
  defineMethod({
    name: 'hqProjects.replyClickUpReview',

    permission: 'workspace',
    params: HqClickUpReviewReplyParams,
    handler: async (params) => service().reply(params)
  })
]

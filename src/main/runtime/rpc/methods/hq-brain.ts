// Custom build (hq-plus-brain): HQ+'s «Brain» screen — every mention of a task, an MR, a person or a
// project by day, from HQ's brain index with Pulse's states added.
import { defineMethod } from '../core'
import { HqBrainParams } from '../../../../shared/rpc-contract/hq-journal-params'
import { getHqBrain } from '../../../hq-brain/hq-brain'

export const HQ_BRAIN_METHODS = [
  defineMethod({
    name: 'hq.brain',

    permission: 'workspace',
    params: HqBrainParams,
    handler: async (params) => {
      const brain = getHqBrain()
      if (!brain) {
        throw new Error('The HQ+ brain is not available on this host.')
      }
      return brain.look(params.query)
    }
  })
]

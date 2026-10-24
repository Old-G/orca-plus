// Custom build (hq-plus-phone): what HQ+ on the phone needs of the Mac beyond the desktop's own
// reads — «Write to HQ» goes to the Ask HQ chat in the Orca+ window, where that chat lives.
import { defineMethod } from '../core'
import { HqAskOnDesktopParams } from '../../../../shared/rpc-contract/hq-projects-params'
import { runHqAskOnDesktop } from '../../../hq-today/hq-request-on-desktop'

export const HQ_PLUS_PHONE_METHODS = [
  defineMethod({
    name: 'hqProjects.askHqOnDesktop',

    permission: 'workspace',
    params: HqAskOnDesktopParams,
    handler: async (params) => runHqAskOnDesktop(params.text)
  })
]

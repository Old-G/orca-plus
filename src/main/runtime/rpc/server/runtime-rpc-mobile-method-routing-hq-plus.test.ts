import { describe, expect, it } from 'vitest'
import { MOBILE_RPC_METHOD_ROUTES } from './runtime-rpc-mobile-method-routing'

// Custom build (hq-plus-phone): HQ+ on the phone reads and replies through the Mac; Approve stays there.
describe('mobile RPC method routing — HQ+ on the phone (custom build)', () => {
  it.each([
    'hq.feed',
    'hq.screenStats',
    'chat.send',
    'pulse.markInboxDone',
    'hqProjects.askHqOnDesktop',
    'hqProjects.spaces',
    'hqProjects.chatList',
    'pulse.snapshot'
  ])('answers HQ+ %s on the paired desktop', (method) => {
    expect(MOBILE_RPC_METHOD_ROUTES.get(method)).toBe('paired-desktop')
  })

  it('routes no way to decide an outgoing message from the phone', () => {
    const routed = [...MOBILE_RPC_METHOD_ROUTES.keys()]
    expect(
      routed.filter((method) => /^(pulse|outgoingApproval)\.(decide|.*[Dd]eliver)/.test(method))
    ).toEqual([])
  })
})

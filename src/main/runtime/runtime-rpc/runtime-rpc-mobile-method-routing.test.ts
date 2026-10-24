import { describe, expect, it } from 'vitest'
import { MOBILE_RPC_METHOD_ROUTES } from './runtime-rpc-mobile-method-routing'

describe('mobile RPC method routing census', () => {
  it.each([
    'jira.status',
    'jira.listIssues',
    'jira.searchIssues',
    'jira.getIssue',
    'jira.issueComments'
  ])('keeps %s on the paired desktop that owns its Jira connection', (method) => {
    expect(MOBILE_RPC_METHOD_ROUTES.get(method)).toBe('paired-desktop')
  })

  it('routes no per-section collapse write while the sidebar-inputs switch is off', () => {
    expect(MOBILE_RPC_METHOD_ROUTES.has('ui.setCollapsed')).toBe(false)
  })

  // Custom build (hq-plus-phone): HQ+ on the phone reads and replies through the Mac; Approve stays there.
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

  it('sends a targeted status to the server, whose features a server workspace gates on', () => {
    expect(MOBILE_RPC_METHOD_ROUTES.get('status.get')).toBe('execution-host')
  })
})

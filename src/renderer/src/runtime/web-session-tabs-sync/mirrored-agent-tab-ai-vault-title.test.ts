import { describe, expect, it } from 'vitest'
import type { RuntimeMobileSessionTabsResult } from '../../../../shared/runtime-types'
import type { Tab } from '../../../../shared/tab-types'
import { buildMirroredAgentTabs } from './terminal-surfaces'

const WORKTREE = 'repo-1::worktree-1'
const GROUP = 'group-1'

function snapshotWith(agent: 'claude' | 'codex', title: string): RuntimeMobileSessionTabsResult {
  return {
    worktree: WORKTREE,
    publicationEpoch: 'epoch-1',
    snapshotVersion: 1,
    activeGroupId: GROUP,
    activeTabId: null,
    activeTabType: null,
    tabs: [
      {
        type: 'agent-session',
        id: 'host-tab-1',
        title,
        sessionId: `${agent}-1`,
        agent,
        isActive: false
      }
    ]
  } as RuntimeMobileSessionTabsResult
}

function build(
  snapshot: RuntimeMobileSessionTabsResult,
  currentUnifiedTabs: readonly Tab[] = []
): Tab {
  const [mirrored] = buildMirroredAgentTabs(
    snapshot,
    'runtime:env-1',
    new Map(),
    GROUP,
    0,
    currentUnifiedTabs,
    1_000
  )
  return mirrored.unifiedTab
}

// Custom build (native-chat-titles): kept apart from the suite upstream removed (#37581).
describe('buildMirroredAgentTabs conversation titles', () => {
  // Custom build (native-chat-titles): dropping it made the title sync rewrite it on every snapshot.
  it('keeps the conversation name the title sync stored across host snapshots', () => {
    const snapshot = snapshotWith('claude', 'Claude Chat')
    const titled: Tab = {
      ...build(snapshot),
      aiVaultTitle: { title: 'Fix login flow', sessionId: 'claude-1', agent: 'claude' }
    }
    expect(build(snapshot, [titled]).aiVaultTitle).toEqual(titled.aiVaultTitle)
  })
})

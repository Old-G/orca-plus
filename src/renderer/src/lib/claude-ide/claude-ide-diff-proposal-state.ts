import { useAppStore } from '@/store'
import type { OpenFile } from '@/store/slices/editor'
import type { GitDiffTextResult } from '../../../../shared/git-diff-compare-types'
import type { ClaudeIdeDiffOutcome } from '../../../../shared/claude-ide-bridge-types'

// Pending openDiff proposals (claude-ide). Kept free of Monaco/workspace imports: the
// editor surface and diff loader import it, and so do their tests.

export type ClaudeProposal = {
  fileId: string
  tabName: string
  originalContent: string
  proposedContent: string
  /** The right side as the user left it; accepted as-is. */
  latestContent: string
  settle: (outcome: ClaudeIdeDiffOutcome) => void
}

const proposals = new Map<string, ClaudeProposal>()

export function requiredString(params: Record<string, unknown>, key: string): string {
  const value = params[key]
  if (typeof value !== 'string') {
    throw new Error(`${key} is required`)
  }
  return value
}

function proposalByTabName(tabName: string): ClaudeProposal | undefined {
  return [...proposals.values()].find((proposal) => proposal.tabName === tabName)
}

/** Registers a pending proposal; a previous one with the same tab name is rejected. */
export function registerClaudeProposal(proposal: ClaudeProposal): void {
  const previous = proposalByTabName(proposal.tabName)
  if (previous) {
    finish(previous.fileId, { accepted: false })
  }
  proposals.set(proposal.fileId, proposal)
}

/** Settles once and closes the tab; later calls (close_tab after accept) are no-ops. */
function finish(fileId: string, outcome: ClaudeIdeDiffOutcome): boolean {
  const proposal = proposals.get(fileId)
  if (!proposal) {
    return false
  }
  proposals.delete(fileId)
  proposal.settle(outcome)
  if (useAppStore.getState().openFiles.some((file) => file.id === fileId)) {
    useAppStore.getState().closeFile(fileId)
  }
  return true
}

export function isClaudeProposalFile(file: Pick<OpenFile, 'diffSource'>): boolean {
  return file.diffSource === 'claude-proposal'
}

export function acceptClaudeProposal(fileId: string, contents?: string): void {
  const proposal = proposals.get(fileId)
  if (proposal) {
    finish(fileId, { accepted: true, contents: contents ?? proposal.latestContent })
  }
}

export function rejectClaudeProposal(fileId: string): void {
  finish(fileId, { accepted: false })
}

export function updateClaudeProposalContent(fileId: string, contents: string): void {
  const proposal = proposals.get(fileId)
  if (proposal) {
    proposal.latestContent = contents
  }
}

/** Diff content for the editor's loader; rejects for a tab whose proposal is gone. */
export async function loadClaudeProposalDiff(fileId: string): Promise<GitDiffTextResult> {
  const proposal = proposals.get(fileId)
  if (!proposal) {
    throw new Error('This Claude proposal is no longer pending.')
  }
  return {
    kind: 'text',
    originalContent: proposal.originalContent,
    modifiedContent: proposal.proposedContent,
    originalIsBinary: false,
    modifiedIsBinary: false
  }
}

/** Shown in the tab when its proposal is gone (e.g. the window reloaded meanwhile). */
export function claudeProposalLoadError(error: unknown): GitDiffTextResult {
  return {
    kind: 'text',
    originalContent: '',
    modifiedContent: error instanceof Error ? error.message : String(error),
    originalIsBinary: false,
    modifiedIsBinary: false
  }
}

export function closeClaudeDiffTab(params: Record<string, unknown>): string {
  const proposal = proposalByTabName(requiredString(params, 'tab_name'))
  if (proposal) {
    finish(proposal.fileId, { accepted: false })
  }
  return '{}'
}

export function closeAllClaudeDiffTabs(): string {
  let closed = 0
  for (const fileId of proposals.keys()) {
    if (finish(fileId, { accepted: false })) {
      closed++
    }
  }
  return JSON.stringify({ closed })
}

/** Closing the tab any way (tab bar, close others, worktree close) rejects the proposal. */
export function watchClosedClaudeProposals(): () => void {
  return useAppStore.subscribe((state, previous) => {
    if (proposals.size === 0 || state.openFiles === previous.openFiles) {
      return
    }
    for (const fileId of proposals.keys()) {
      if (!state.openFiles.some((file) => file.id === fileId)) {
        finish(fileId, { accepted: false })
      }
    }
  })
}

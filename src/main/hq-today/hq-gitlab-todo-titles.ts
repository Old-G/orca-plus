// Custom build (hq-ledger-sources): the GitLab to-do kinds as their cards name them.

/** What each kind of to-do asks, as its card's title says it. */
export const TODO_TITLE: Readonly<Record<string, string>> = {
  review_requested: 'Review requested',
  approval_required: 'Approval required',
  added_approver: 'Approval required',
  assigned: 'Assigned to you',
  build_failed: 'Build failed',
  unmergeable: 'Cannot merge',
  merge_train_removed: 'Removed from merge train',
  review_submitted: 'Review submitted',
  directly_addressed: 'Addressed to you',
  mentioned: 'Mentioned',
  marked: 'To-do'
}

// Custom build (hq-plus-phone): the views the desktop keeps on its right — on the phone they slide in
// from the right as tabs of one panel.
export const HQP_VIEWS = [
  { id: 'agents', label: 'Agents', note: 'MAP' },
  { id: 'river', label: 'River', note: 'WEEK' },
  { id: 'graph', label: 'Graph', note: 'PEOPLE' },
  { id: 'reports', label: 'Reports', note: 'HQ' },
  { id: 'browser', label: 'Browser', note: 'WEB' },
  { id: 'deferred', label: 'Deferred', note: 'QUIET' }
] as const

export type HqpView = (typeof HQP_VIEWS)[number]['id']

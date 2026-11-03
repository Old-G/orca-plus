// Custom build (hq-ledger-cutover, owner 03.11, plan 20.9): the request ledger is Orca+'s one Slack
// reader by default — «make the new system and move to it». Shadow (the scout's cards, the ledger
// beside them) and off stay in Settings as the way back.
export type HqLedgerMode = 'off' | 'shadow' | 'on'

export function hqLedgerMode(
  settings: { hqLedger?: HqLedgerMode } | null | undefined
): HqLedgerMode {
  return settings?.hqLedger ?? 'on'
}

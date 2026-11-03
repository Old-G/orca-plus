// Custom build (hq-ledger-cutover, plan 20.9): whether the request ledger stands in for the scout's
// Slack cards and promises. Only with the ledger on AND its last pass read Slack — with no token, or one
// Slack rejected or that can no longer be decrypted, the ledger reads nothing, and retiring the scout
// would leave HQ with no Slack cards at all (Codex P1, 04.11). The ledger's own reads decide, not the
// token status other readers share; until its first pass the scout's cards stay.
import { hqLedgerMode } from '../../shared/hq-ledger-mode'

let ledgerReadSlack = false

/** The ledger reader's last pass: true when it got Slack's messages. */
export function noteHqLedgerReadSlack(ok: boolean): void {
  ledgerReadSlack = ok
}

export function hqLedgerReplacesScout(
  settings: Parameters<typeof hqLedgerMode>[0],
  readSlack: () => boolean = () => ledgerReadSlack
): boolean {
  return hqLedgerMode(settings) === 'on' && readSlack()
}

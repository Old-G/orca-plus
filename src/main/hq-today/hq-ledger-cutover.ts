// Custom build (hq-ledger-cutover, plan 20.9): whether the request ledger stands in for the scout's
// Slack cards and promises. Only with the ledger on AND the owner's Slack user token connected — without
// the token the ledger reads nothing, and retiring the scout would leave HQ with no Slack cards at all
// (Codex P1, 04.11). Both HQ views read these same cards, so classic HQ keeps them as well.
import { hqLedgerMode } from '../../shared/hq-ledger-mode'
import { hasSlackReaderToken } from '../slack/slack-reader-token-store'

export function hqLedgerReplacesScout(
  settings: Parameters<typeof hqLedgerMode>[0],
  readerConnected: () => boolean = hasSlackReaderToken
): boolean {
  return hqLedgerMode(settings) === 'on' && readerConnected()
}

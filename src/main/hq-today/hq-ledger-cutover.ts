// Custom build (hq-ledger-cutover, plan 20.9): whether the request ledger stands in for the scout's
// Slack cards and promises. Only with the ledger on AND its Slack reader working — with no token, or one
// Slack rejected or that can no longer be decrypted, the ledger reads nothing, and retiring the scout
// would leave HQ with no Slack cards at all (Codex P1, 04.11). Both HQ views read these same cards.
import { hqLedgerMode } from '../../shared/hq-ledger-mode'
import { getSlackReaderStatus } from '../slack/slack-reader'

function slackReaderWorks(): boolean {
  const status = getSlackReaderStatus()
  return status.connected && !status.error
}

export function hqLedgerReplacesScout(
  settings: Parameters<typeof hqLedgerMode>[0],
  readerWorks: () => boolean = slackReaderWorks
): boolean {
  return hqLedgerMode(settings) === 'on' && readerWorks()
}

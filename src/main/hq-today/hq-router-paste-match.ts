// Custom build (hq-router T0, owner 28.11): the owner pasted a Slack message — its link or its words —
// into a chat instead of pressing «Send» on its card. The card's router_log row ends «paste» with that
// chat as the choice, so the week's evidence counts what he did and not only what the card offered.
import { HQ_INTAKE_KIND, readHqIntake, type HqIntake } from '../../shared/hq-slack-intake'
import { hqRouterPasteParts } from '../../shared/hq-router-paste'
import type { OrcaRuntimeService } from '../runtime/orca-runtime'
import { hqRouterLogKey } from './hq-intake-close-route'
import { parseHqRouterLink } from './register-hq-router'

const MIN_TEXT = 24
const PROBE = 80

function squash(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim()
}

/** The cards a pasted message belongs to: by a link to the message (or one it was folded with), or by its words. */
export function hqRouterPasteMatches(message: string, cards: readonly HqIntake[]): string[] {
  const links = hqRouterPasteParts(message).links.flatMap((url) => {
    const link = parseHqRouterLink(url)
    return link ? [link] : []
  })
  const body = squash(message)
  const keys: string[] = []
  for (const card of cards) {
    const byLink = links.some(
      (link) =>
        link.channel === card.channel && (link.ts === card.ts || !!card.more?.includes(link.ts))
    )
    const words = squash(card.text).slice(0, PROBE)
    const byText = words.length >= MIN_TEXT && body.includes(words)
    if (byLink || byText) {
      keys.push(hqRouterLogKey(card))
    }
  }
  return keys
}

export function hqRouterNotePaste(
  runtime: OrcaRuntimeService,
  sessionId: string,
  message: string,
  at: number
): void {
  // Why: what Orca+ or another chat delivers carries the card's words too; only the owner's own paste counts.
  if (/^\s*(Orca\+ ·|From |От лида)/.test(message)) {
    return
  }
  try {
    const cards = runtime.pulseListInbox(false, { kind: HQ_INTAKE_KIND }).flatMap((item) => {
      const intake = readHqIntake(item.refId)
      return intake ? [intake] : []
    })
    if (cards.length === 0) {
      return
    }
    for (const key of hqRouterPasteMatches(message, cards)) {
      runtime.pulseRouter().logOutcome(key, { outcome: 'paste', at, chosen: sessionId })
    }
  } catch (error) {
    console.warn('[hq-router] paste not matched', error)
  }
}

import { useEffect } from 'react'
import { toast } from 'sonner'
import type { ClaudeHandoffOffer } from '../../../shared/claude-handoff-file'
import { translate } from '@/i18n/i18n'
import { isWebClientLocation } from '@/lib/web-client-location'
import { activateAndRevealWorktree } from '@/lib/worktree-activation'

const toastId = (offer: ClaudeHandoffOffer): string => `claude-handoff-${offer.id}`

export function describeClaudeHandoffOffer(offer: ClaudeHandoffOffer): string {
  const parts = [offer.worktreeTitle]
  if (offer.branch) {
    parts.push(offer.head ? `${offer.branch} @ ${offer.head}` : offer.branch)
  }
  if (offer.pushed === 'no') {
    parts.push(translate('auto.claudeHandoff.offer.notPushed', 'not pushed'))
  } else if (offer.pushed === 'yes') {
    parts.push(translate('auto.claudeHandoff.offer.pushed', 'pushed'))
  }
  return parts.join(' · ')
}

async function launch(offer: ClaudeHandoffOffer): Promise<void> {
  await launchClaudeHandoffOffer(offer.id)
}

/** Custom build (pulse-bell): the bell's "New session" runs the same launch as the toast. */
export async function launchClaudeHandoffOffer(offerId: string): Promise<void> {
  const result = await window.api.claudeHandoff.launch(offerId)
  if (!result.ok) {
    toast.error(
      translate('auto.claudeHandoff.offer.launchFailed', 'Could not start the new session'),
      { description: result.error }
    )
    return
  }
  activateAndRevealWorktree(result.worktreeId)
}

/**
 * Custom build (claude-handoff-launch): when a Claude session stops after saving a handoff, offers
 * to start a fresh session in the same workspace with the handoff's prompt.
 */
export function useClaudeHandoffOffers(): void {
  useEffect(() => {
    // Why: the paired web client has no handoff bridge; the desktop owns these offers.
    if (isWebClientLocation()) {
      return
    }
    const shown = new Map<string, string>()
    const show = (offers: ClaudeHandoffOffer[]): void => {
      const live = new Set(offers.map(toastId))
      for (const [id] of shown) {
        if (!live.has(id)) {
          toast.dismiss(id)
          shown.delete(id)
        }
      }
      for (const offer of offers) {
        const id = toastId(offer)
        if (shown.get(id) === offer.created) {
          continue
        }
        shown.set(id, offer.created)
        toast.info(
          translate(
            'auto.claudeHandoff.offer.title',
            'Context is filling up — handoff saved, prompt ready'
          ),
          {
            id,
            description: describeClaudeHandoffOffer(offer),
            duration: Number.POSITIVE_INFINITY,
            action: {
              label: translate('auto.claudeHandoff.offer.start', 'New session'),
              onClick: () => void launch(offer)
            },
            cancel: {
              label: translate('auto.claudeHandoff.offer.dismiss', 'Not now'),
              onClick: () => void window.api.claudeHandoff.dismiss(offer.id)
            }
          }
        )
      }
    }
    const off = window.api.claudeHandoff.onOffersChanged(show)
    void window.api.claudeHandoff.list().then(show)
    return off
  }, [])
}

// Custom build (hq-remind): «Remind» on a bell line — a fresh HQ chat writes the nudge to the person
// who has not answered, by the ask-person skill; it goes out only through Approve.
import { readHqPulse } from '../../../../../shared/hq-pulse-snapshot'
import { hqRemindPrompt } from '../../../../../shared/hq-remind'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import { startHqChatWithPrompt } from './hq-ask-chat'
import { findHqWorktreeId, type HqActionResult } from './hq-today-actions'

export async function startHqRemind(waitingId: string): Promise<HqActionResult> {
  const state = useAppStore.getState()
  const worktreeId = findHqWorktreeId(state.settings?.hqPath, state.repos, state.worktreesByRepo)
  if (!worktreeId) {
    return {
      ok: false,
      message: translate('auto.hq.remind.noHq', 'Add the HQ folder as a project first.')
    }
  }
  const response = await window.api.runtime.call({ method: 'pulse.snapshot' })
  const pulse = response.ok ? readHqPulse(response.result) : null
  const waiting = pulse?.waitings.find((entry) => entry.id === waitingId)
  if (!pulse || !waiting) {
    return {
      ok: false,
      message: translate('auto.hq.remind.gone', 'This question is already closed.')
    }
  }
  const person = pulse.people.find((entry) => entry.id === waiting.personId)?.name ?? null
  const started = await startHqChatWithPrompt(
    worktreeId,
    hqRemindPrompt(waiting, person, Date.now()),
    translate('auto.hq.remind.chatName', 'Remind {{name}}', { name: person ?? '…' })
  )
  return started.ok ? { ok: true } : started
}

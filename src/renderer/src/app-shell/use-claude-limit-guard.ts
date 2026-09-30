import { useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  claudeLimitsAccountId,
  claudeLimitSwitchSuggestionKey,
  describeClaudeAccount,
  suggestClaudeAccountSwitch,
  CLAUDE_LIMIT_SWITCH_THRESHOLD_PERCENT,
  type ClaudeLimitStoppedAgent,
  type ClaudeLimitSwitchSuggestion
} from '../../../shared/claude-limit-guard'
import type { GlobalSettings } from '../../../shared/global-settings-types'
import { translate } from '@/i18n/i18n'
import { PULSE_BELL_ACTION, PULSE_BELL_KIND, type PulseBellInput } from '../../../shared/pulse-bell'
import { recordClaudeUsageSample } from '@/lib/claude-usage-pace-store'
import { isWebClientLocation } from '@/lib/web-client-location'
import { selectClaudeProviderAccount } from '@/runtime/runtime-provider-accounts-client'
import { useAppStore } from '@/store'

const TOAST_ID = 'claude-limit-switch'
const INACTIVE_REFRESH_MS = 3 * 60_000

function accountLabel(settings: GlobalSettings | null, accountId: string | null): string {
  if (accountId === null) {
    return translate('auto.components.status.bar.StatusBar.c676918adc', 'System default')
  }
  const accounts = settings?.claudeManagedAccounts ?? []
  const account = accounts.find((entry) => entry.id === accountId)
  return account ? describeClaudeAccount(accounts, account) : accountId
}

function formatTime(at: number | null): string {
  return at === null
    ? '—'
    : new Date(at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}

async function switchAccount(suggestion: ClaudeLimitSwitchSuggestion): Promise<void> {
  await switchClaudeAccountTo(suggestion.toAccountId)
}

/** Custom build (pulse-bell): the bell's "Switch account" runs the same switch as the card. */
export async function switchClaudeAccountTo(accountId: string): Promise<void> {
  const { settings, fetchSettings, recordFeatureInteraction } = useAppStore.getState()
  try {
    await selectClaudeProviderAccount(settings, {
      accountId,
      runtime: 'host',
      wslDistro: null
    })
    recordFeatureInteraction('claude-account-switching')
    await fetchSettings()
  } catch (error) {
    toast.error(translate('auto.claudeLimit.switchFailed', 'Could not switch the Claude account'), {
      description: error instanceof Error ? error.message : String(error)
    })
  }
}

// Custom build (pulse-bell): the bell mirrors the card; closing the card closes the item.
function syncLimitBell(items: PulseBellInput[]): void {
  if (isWebClientLocation()) {
    return
  }
  void window.api.pulseBell
    .syncKind(PULSE_BELL_KIND.claudeLimit, items)
    .catch((error: unknown) => console.warn('[pulse-bell] limit sync failed:', error))
}

/**
 * Custom build (claude-limit-guard): when the active Claude account nears its limit (or agents
 * already stopped on it), offers the account with the most room. Main nudges the stopped agents
 * once the switch lands, however it was made.
 */
export function useClaudeLimitGuard(): void {
  const claude = useAppStore((s) => s.rateLimits.claude)
  const inactive = useAppStore((s) => s.rateLimits.inactiveClaudeAccounts)
  const settings = useAppStore((s) => s.settings)
  const fetchInactiveClaudeAccountUsage = useAppStore((s) => s.fetchInactiveClaudeAccountUsage)
  const activeAccountId =
    settings?.activeClaudeManagedAccountIdsByRuntime?.host ??
    settings?.activeClaudeManagedAccountId ??
    null
  const [stops, setStops] = useState<ClaudeLimitStoppedAgent[]>([])
  const dismissedKeys = useRef(new Set<string>())
  const shownKey = useRef<string | null>(null)
  const enabled = !isWebClientLocation() && (settings?.claudeManagedAccounts.length ?? 0) > 0

  useEffect(() => {
    if (isWebClientLocation()) {
      return
    }
    const off = window.api.claudeLimitGuard.onStopsChanged(setStops)
    void window.api.claudeLimitGuard.list().then(setStops)
    return off
  }, [])

  // Why: right after a switch the reading can still belong to the previous account.
  const activeLimits = claude && claudeLimitsAccountId(claude) === activeAccountId ? claude : null

  useEffect(() => {
    if (activeLimits) {
      recordClaudeUsageSample(activeAccountId, activeLimits)
    }
  }, [activeLimits, activeAccountId])

  const stopsOnActive = stops.filter((stop) => stop.accountId === activeAccountId)
  const stoppedOnActive = stopsOnActive.length
  const lastStopAt = stopsOnActive.reduce((latest, stop) => Math.max(latest, stop.stoppedAt), 0)
  const hot =
    enabled &&
    (stoppedOnActive > 0 ||
      [activeLimits?.session, activeLimits?.weekly].some(
        (window) => (window?.usedPercent ?? 0) >= CLAUDE_LIMIT_SWITCH_THRESHOLD_PERCENT
      ))

  useEffect(() => {
    if (!hot) {
      return
    }
    void fetchInactiveClaudeAccountUsage()
    const timer = window.setInterval(
      () => void fetchInactiveClaudeAccountUsage(),
      INACTIVE_REFRESH_MS
    )
    return () => window.clearInterval(timer)
  }, [hot, fetchInactiveClaudeAccountUsage])

  const suggestion = useMemo(
    () =>
      hot && (activeLimits || stoppedOnActive > 0)
        ? suggestClaudeAccountSwitch({
            activeAccountId,
            active: activeLimits,
            inactive,
            // Why: judge the other accounts' freshness against the active reading's own clock.
            now: activeLimits?.updatedAt ?? lastStopAt,
            limitStopObserved: stoppedOnActive > 0
          })
        : null,
    [hot, activeLimits, activeAccountId, inactive, stoppedOnActive, lastStopAt]
  )

  useEffect(() => {
    const key = suggestion ? claudeLimitSwitchSuggestionKey(suggestion) : null
    if (!suggestion || !key || dismissedKeys.current.has(key)) {
      syncLimitBell([])
      if (shownKey.current) {
        toast.dismiss(TOAST_ID)
        shownKey.current = null
      }
      return
    }
    shownKey.current = key
    const windowLabel =
      suggestion.window === 'session'
        ? translate('auto.claudeLimit.window.session', '5-hour limit')
        : translate('auto.claudeLimit.window.weekly', 'weekly limit')
    const description = [
      suggestion.targetFreePercent === null
        ? translate(
            'auto.claudeLimit.card.targetUnknown',
            "{{account}}'s usage could not be read; it may still have room.",
            { account: accountLabel(settings, suggestion.toAccountId) }
          )
        : translate('auto.claudeLimit.card.target', '{{account}} has {{free}}% free.', {
            account: accountLabel(settings, suggestion.toAccountId),
            free: suggestion.targetFreePercent
          }),
      stoppedOnActive > 0
        ? translate(
            'auto.claudeLimit.card.stopped',
            'Agents stopped on the limit: {{count}} — they continue after the switch.',
            { count: stoppedOnActive }
          )
        : translate(
            'auto.claudeLimit.card.running',
            'Running agents pick up the new account on their own.'
          )
    ].join(' ')
    const title = translate(
      'auto.claudeLimit.card.title',
      '{{account}}: {{percent}}% of the {{window}}, resets at {{time}}',
      {
        account: accountLabel(settings, suggestion.fromAccountId),
        percent: suggestion.usedPercent,
        window: windowLabel,
        time: formatTime(suggestion.resetsAt)
      }
    )
    syncLimitBell([
      {
        kind: PULSE_BELL_KIND.claudeLimit,
        title,
        body: description,
        urgency: stoppedOnActive > 0 ? 'urgent' : 'normal',
        refKind: 'claude-account',
        refId: suggestion.toAccountId,
        actions: [
          {
            id: PULSE_BELL_ACTION.switchAccount,
            label: translate('auto.claudeLimit.card.switch', 'Switch account')
          },
          {
            id: PULSE_BELL_ACTION.dismiss,
            label: translate('auto.claudeLimit.card.dismiss', 'Not now')
          }
        ],
        dedupeKey: `claude-limit:${key}`
      }
    ])
    toast.warning(title, {
      id: TOAST_ID,
      description,
      duration: Number.POSITIVE_INFINITY,
      action: {
        label: translate('auto.claudeLimit.card.switch', 'Switch account'),
        onClick: () => {
          shownKey.current = null
          void switchAccount(suggestion)
        }
      },
      cancel: {
        label: translate('auto.claudeLimit.card.dismiss', 'Not now'),
        onClick: () => {
          dismissedKeys.current.add(key)
          shownKey.current = null
        }
      }
    })
  }, [suggestion, settings, stoppedOnActive])
}

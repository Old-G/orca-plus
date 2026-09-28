// Custom build (claude-limit-guard): recent active-account Claude usage, for the pace forecast.
import { useStore } from 'zustand'
import { createStore } from 'zustand/vanilla'
import {
  appendClaudeUsageSample,
  forecastClaudeUsage,
  toClaudeUsageSample,
  type ClaudeUsageForecast,
  type ClaudeUsageSample
} from '../../../shared/claude-limit-guard'
import type { ProviderRateLimits } from '../../../shared/rate-limit-types'

type PaceState = {
  accountId: string | null
  samples: readonly ClaudeUsageSample[]
  forecast: ClaudeUsageForecast | null
}

const paceStore = createStore<PaceState>(() => ({ accountId: null, samples: [], forecast: null }))

export function recordClaudeUsageSample(
  accountId: string | null,
  limits: ProviderRateLimits,
  now = Date.now()
): void {
  if (limits.status !== 'ok') {
    return
  }
  const previous = paceStore.getState()
  // Why: another account's pace says nothing about this one.
  const base = previous.accountId === accountId ? previous.samples : []
  const samples = appendClaudeUsageSample(base, toClaudeUsageSample(limits, now))
  paceStore.setState({ accountId, samples, forecast: forecastClaudeUsage(samples, now) })
}

export function useClaudeUsageForecast(): ClaudeUsageForecast | null {
  return useStore(paceStore, (state) => state.forecast)
}

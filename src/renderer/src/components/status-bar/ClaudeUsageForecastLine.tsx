// Custom build (claude-limit-guard): "at this pace the limit runs out at HH:MM" for the active account.
import React from 'react'
import { translate } from '@/i18n/i18n'
import { useClaudeUsageForecast } from '@/lib/claude-usage-pace-store'

export function ClaudeUsageForecastLine(): React.JSX.Element | null {
  const forecast = useClaudeUsageForecast()
  if (!forecast) {
    return null
  }
  const at = new Date(forecast.exhaustsAt)
  const time = at.toLocaleString(undefined, {
    ...(at.toDateString() === new Date().toDateString() ? {} : { weekday: 'short' }),
    hour: '2-digit',
    minute: '2-digit'
  })
  return (
    <div className="px-2 py-1.5 text-[11px] leading-4 text-muted-foreground">
      {forecast.window === 'session'
        ? translate(
            'auto.claudeLimit.forecast.session',
            'At this pace the 5-hour limit runs out at {{time}}',
            { time }
          )
        : translate(
            'auto.claudeLimit.forecast.weekly',
            'At this pace the weekly limit runs out at {{time}}',
            { time }
          )}
    </div>
  )
}

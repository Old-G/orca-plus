// Custom build (claude-background-pause): HQ says when its background work is held off — the selected
// Claude account passed 95% of its week, so automations, Slack/ClickUp/GitLab reading and the nightly
// jobs wait for the reset and then start again by themselves.
import { useEffect, useState } from 'react'
import { getIntlLocale } from '@/i18n/i18n'
import {
  CLAUDE_BACKGROUND_PAUSE_PERCENT,
  type ClaudeBackgroundPause
} from '../../../../../shared/claude-background-pause'

export function useClaudeBackgroundPause(): ClaudeBackgroundPause | null {
  const [pause, setPause] = useState<ClaudeBackgroundPause | null>(null)
  useEffect(() => {
    const api = window.api?.claudeLimitGuard
    if (!api?.backgroundPause) {
      return
    }
    let live = true
    void api.backgroundPause().then(
      (next) => live && setPause(next),
      () => undefined
    )
    const off = api.onBackgroundPauseChanged((next) => setPause(next))
    return () => {
      live = false
      off()
    }
  }, [])
  // Why: the main process lifts it at the reset too; this keeps a sleeping window from showing it after.
  useEffect(() => {
    if (pause?.resumesAt == null) {
      return
    }
    const wait = pause.resumesAt - Date.now()
    if (wait <= 0) {
      setPause(null)
      return
    }
    const timer = setTimeout(() => setPause(null), Math.min(wait, 2_147_000_000))
    return () => clearTimeout(timer)
  }, [pause])
  return pause
}

export function formatBackgroundResume(resumesAt: number | null): string {
  if (resumesAt === null) {
    return 'the weekly reset'
  }
  return new Date(resumesAt).toLocaleString(getIntlLocale(), {
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit'
  })
}

export function HqBackgroundPauseBadge({
  className
}: {
  className?: string
}): React.JSX.Element | null {
  const pause = useClaudeBackgroundPause()
  if (!pause) {
    return null
  }
  const until = formatBackgroundResume(pause.resumesAt)
  return (
    <span
      className={className}
      role="status"
      data-testid="hq-background-pause"
      title={`Weekly Claude limit ${pause.weeklyPercent}% (pause from ${CLAUDE_BACKGROUND_PAUSE_PERCENT}%). Automations, Slack, ClickUp and GitLab reading and the nightly jobs start again by themselves after the reset.`}
    >
      Background paused until {until}
    </span>
  )
}

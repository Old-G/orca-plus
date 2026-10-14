// Custom build (hq): once a morning, one bell line with how many sessions are deferred — counted
// here because only the renderer sees the agents, then dropped so the sidebar does no more work.
import { useEffect, useRef, useState } from 'react'
import {
  HQ_BRIEFING_HOUR,
  HQ_DEFERRED_KIND,
  hqLocalDay
} from '../../../../../shared/hq-morning-briefing'
import { PULSE_BELL_ACTION } from '../../../../../shared/pulse-bell'
import { useNow } from '@/hooks/use-now'
import { translate } from '@/i18n/i18n'
import { useLiveDashboardSnapshot } from '../../dashboard/useLiveDashboardSnapshot'
import { useHqDeferredSessions } from './use-hq-deferred-sessions'

const CHECK_MS = 5 * 60_000
// Why: workspace git states arrive a moment after the list is first built.
const SETTLE_MS = 30_000

function Counter({ day, onDone }: { day: string; onDone: () => void }): null {
  const snapshot = useLiveDashboardSnapshot()
  const { sessions } = useHqDeferredSessions(snapshot.cards)
  const count = useRef(0)
  count.current = sessions.length
  useEffect(() => {
    const timer = setTimeout(() => {
      // Why: with nothing deferred, no sync at all — an empty sync would close this morning's line.
      if (count.current > 0) {
        void window.api.pulseBell
          .syncKind(HQ_DEFERRED_KIND, [
            {
              kind: HQ_DEFERRED_KIND,
              title:
                count.current === 1
                  ? translate('auto.hq.deferredBell.titleOne', '1 deferred session')
                  : translate('auto.hq.deferredBell.titleMany', '{{value0}} deferred sessions', {
                      value0: String(count.current)
                    }),
              body: translate(
                'auto.hq.deferredBell.body',
                'Quiet sessions with their work unfinished — on HQ → Agents.'
              ),
              actions: [
                { id: PULSE_BELL_ACTION.open, label: translate('auto.hq.deferredBell.open', 'Open') }
              ],
              dedupeKey: `${HQ_DEFERRED_KIND}:${day}`
            }
          ])
          .catch(() => undefined)
      }
      onDone()
    }, SETTLE_MS)
    return () => clearTimeout(timer)
  }, [day, onDone])
  return null
}

export function HqDeferredBell(): React.JSX.Element | null {
  const now = useNow(CHECK_MS)
  const [doneDay, setDoneDay] = useState<string | null>(null)
  const day = hqLocalDay(now)
  if (doneDay === day || new Date(now).getHours() < HQ_BRIEFING_HOUR) {
    return null
  }
  return <Counter day={day} onDone={() => setDoneDay(day)} />
}

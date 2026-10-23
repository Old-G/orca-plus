// Custom build (hq-plus-ui): Река — one lane per project over the last seven days: green where an agent
// worked, dashed where it waits on a person (red once that is old), and what still runs today below.
import type { HqPlusLane } from '../../../../../shared/hq-plus-river-graph'
import type { HqPlusUpcoming } from './hq-plus-rpc-readers'
import { translate } from '@/i18n/i18n'

const DAY_MS = 24 * 60 * 60_000
const DAYS = 7

function swatch(color: string): React.CSSProperties & Record<'--hqp-sw', string> {
  return { '--hqp-sw': color }
}

function pct(value: number): string {
  return `${(value * 100).toFixed(2)}%`
}

function weekTicks(now: number): string[] {
  const ticks: string[] = []
  for (let back = DAYS - 1; back >= 1; back -= 1) {
    ticks.push(new Date(now - back * DAY_MS).toLocaleDateString(undefined, { weekday: 'short' }))
  }
  ticks.push(translate('auto.hqPlus.river.today', 'today'))
  return ticks
}

function noteOf(lane: HqPlusLane): { text: string; tone: 'long' | 'wait' | undefined } {
  if (lane.note.kind === 'wait') {
    return {
      text:
        lane.note.days === 0
          ? translate('auto.hqPlus.river.waitToday', '{{person}} · today', {
              person: lane.note.person
            })
          : translate('auto.hqPlus.river.wait', '{{person}} · {{days}} d', {
              person: lane.note.person,
              days: lane.note.days
            }),
      tone: lane.note.long ? 'long' : 'wait'
    }
  }
  if (lane.note.kind === 'today') {
    return { text: translate('auto.hqPlus.river.active', 'worked today'), tone: undefined }
  }
  return {
    text: translate('auto.hqPlus.river.quiet', 'quiet {{days}} d', { days: lane.note.days }),
    tone: undefined
  }
}

export function HqPlusRiver({
  lanes,
  upcoming,
  current,
  now,
  onPick
}: {
  lanes: HqPlusLane[]
  upcoming: HqPlusUpcoming[]
  current: string | null
  now: number
  onPick: (lane: HqPlusLane) => void
}): React.JSX.Element {
  return (
    <div>
      <div className="hqp-river">
        {lanes.length === 0 ? (
          <p className="hqp-empty hqp-quiet">
            {translate('auto.hqPlus.river.empty', 'No project moved this week.')}
          </p>
        ) : null}
        {lanes.map((lane) => {
          const note = noteOf(lane)
          const workingNow = lane.work.some(([, to]) => to >= 1)
          return (
            <button
              key={lane.project}
              type="button"
              className="hqp-lane"
              aria-current={current === lane.project ? 'true' : undefined}
              onClick={() => onPick(lane)}
            >
              <span className="nm">{lane.project}</span>
              <span className="hqp-tr">
                {lane.work.map(([from, to]) => (
                  <b key={from} style={{ left: pct(from), width: pct(to - from) }} />
                ))}
                {lane.wait ? (
                  <s
                    data-long={lane.wait.long ? 'true' : undefined}
                    style={{ left: pct(lane.wait.from), width: pct(1 - lane.wait.from) }}
                  />
                ) : null}
                {workingNow ? <u /> : null}
              </span>
              <span className="why" data-tone={note.tone}>
                {note.text}
              </span>
            </button>
          )
        })}
      </div>
      <div className="hqp-axis" aria-hidden="true">
        <span />
        <span className="hqp-ticks">
          {weekTicks(now).map((tick) => (
            <span key={tick}>{tick}</span>
          ))}
        </span>
        <span />
      </div>
      <div className="hqp-legend">
        <span>
          <i className="hqp-sw" style={swatch('var(--hqp-green)')} />
          {translate('auto.hqPlus.river.legendWork', 'an agent worked')}
        </span>
        <span>
          <i
            className="hqp-sw"
            data-dash="true"
            style={swatch('var(--hqp-red)')}
          />
          {translate('auto.hqPlus.river.legendLong', 'waiting on a person, long')}
        </span>
        <span>
          <i
            className="hqp-sw"
            data-dash="true"
            style={swatch('var(--hqp-amber)')}
          />
          {translate('auto.hqPlus.river.legendWait', 'waiting on a person')}
        </span>
      </div>
      <div className="hqp-hl hqp-river-next">
        {translate('auto.hqPlus.river.next', 'still today')}
      </div>
      {upcoming.length === 0 ? (
        <p className="hqp-empty hqp-quiet">
          {translate('auto.hqPlus.river.nothingNext', 'No automation runs later today.')}
        </p>
      ) : null}
      {upcoming.map((item) => (
        <div key={`${item.at}:${item.name}`} className="hqp-up">
          <span>{new Date(item.at).toTimeString().slice(0, 5)}</span>
          <span>{item.name}</span>
        </div>
      ))}
    </div>
  )
}

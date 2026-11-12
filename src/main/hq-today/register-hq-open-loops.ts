// Custom build (hq-open-loops): the open-loop detector wired to Orca+ — the ledger's
// timelines, the waitings and people pulse keeps, the HQ+ journal and the owner's setting.
import type { Store } from '../persistence/loading-store/store'
import type { OrcaRuntimeService } from '../runtime/orca-runtime'
import { HQ_JOURNAL_KIND } from '../../shared/hq-journal'
import { hqLedgerMode } from '../../shared/hq-ledger-mode'
import { hqOpenLoopsMode } from '../../shared/hq-open-loops-mode'
import { HQ_JOB_SOURCE_PREFIX } from '../hq-journal/hq-journal-jobs'
import { hqLedgerErrorReporter } from './hq-ledger-errors'
import { HQ_OPEN_LOOPS_JOB, runHqOpenLoops } from './hq-open-loops'
import { hqLoopJudgePrompt, parseHqLoopJudge } from './hq-open-loops-judge'
import { generateHqText } from './hq-task-questions'

const PASS_MS = 5 * 60_000
/** Why later than the readers' first pass: the ledger catches up on Slack first. */
const FIRST_PASS_MS = 3 * 60_000
/** Why sonnet: on 42 replies haiku let 4 wrong closes through, sonnet 1 (12.11). */
const JUDGE_MODEL = 'sonnet'
/** Why: a runaway costs a cap, not the day; a day's real closes are well under it. */
const JUDGE_CALLS_PER_DAY = 60

export function startHqOpenLoops(store: Store, runtime: OrcaRuntimeService): () => void {
  const loops = () => runtime.pulseAttribution().openLoops
  const failed = hqLedgerErrorReporter('hq-open-loops', 'Open loops not checked', (rows) =>
    runtime.pulseRecordJournal(rows)
  )
  const calls = { day: '', count: 0 }
  let running = false
  const tick = async (): Promise<void> => {
    if (running) {
      return
    }
    running = true
    try {
      await runHqOpenLoops({
        enabled: () =>
          hqOpenLoopsMode(store.getSettings()) !== 'off' &&
          hqLedgerMode(store.getSettings()) !== 'off',
        timelines: (since) => loops().timelines(since),
        owner: () => loops().owner(),
        records: (since) => loops().records(since),
        record: (kind, loopId, payload) => loops().record(kind, loopId, payload),
        waitings: () => runtime.pulseListWaitings(),
        people: () => runtime.pulseListPeople(),
        lastLineAt: () =>
          runtime.pulseListJournal({
            kind: HQ_JOURNAL_KIND.jobReport,
            source: `${HQ_JOB_SOURCE_PREFIX}${HQ_OPEN_LOOPS_JOB}`,
            limit: 1
          })[0]?.at ?? null,
        journal: (rows) => void runtime.pulseRecordJournal(rows),
        now: Date.now,
        judge: async (ask) => {
          const hqPath = store.getSettings().hqPath
          const day = new Date().toDateString()
          if (!hqPath || (calls.day === day && calls.count >= JUDGE_CALLS_PER_DAY)) {
            return null
          }
          calls.count = calls.day === day ? calls.count + 1 : 1
          calls.day = day
          const result = await generateHqText(
            hqLoopJudgePrompt(ask),
            { emptyResultName: 'open-loop judge', operation: 'hq-open-loops', model: JUDGE_MODEL },
            {
              settings: store.getSettings(),
              cwd: hqPath,
              getAgentEnvResolvers: () => runtime.getCommitMessageAgentEnvironmentResolvers()
            }
          )
          return result.ok ? parseHqLoopJudge(result.text) : null
        }
      })
    } catch (error) {
      failed(error)
    } finally {
      running = false
    }
  }
  const first = setTimeout(() => void tick(), FIRST_PASS_MS)
  const timer = setInterval(() => void tick(), PASS_MS)
  return () => {
    clearTimeout(first)
    clearInterval(timer)
  }
}

// Custom build (hq-plus-cards): the feed's «We wait for» — what people owe, by project, oldest first;
// a waiting whose answer came shows that answer's card in its place (one thing, one place).
import { translate } from '@/i18n/i18n'
import { HqPlusLog, type HqPlusLogContext } from './HqPlusLog'
import { HqPlusWeWaitCard } from './HqPlusWeWaitCard'
import type { HqPlusOtherWait, HqPlusQueueActions } from './HqPlusSideQueues'

export function HqPlusWaitsView({
  waits,
  actions,
  ctx
}: {
  waits: readonly HqPlusOtherWait[]
  actions: HqPlusQueueActions
  ctx: HqPlusLogContext
}): React.JSX.Element {
  if (waits.length === 0) {
    return (
      <p className="hqp-empty">{translate('auto.hqPlus.waits.none', 'Nobody owes you anything.')}</p>
    )
  }
  const byProject = new Map<string, HqPlusOtherWait[]>()
  for (const wait of waits) {
    const project = wait.project ?? 'HQ'
    byProject.set(project, [...(byProject.get(project) ?? []), wait])
  }
  // Why: a project with an answer waiting comes first, then the one waiting longest.
  const projects = [...byProject.entries()].sort(
    ([, a], [, b]) =>
      Number(b.some((wait) => wait.answer)) - Number(a.some((wait) => wait.answer)) ||
      Math.min(...a.map((wait) => wait.at)) - Math.min(...b.map((wait) => wait.at))
  )
  return (
    <div className="hqp-waits">
      {projects.map(([project, list]) => (
        <section key={project} className="hqp-waits-project">
          <h3 className="hqp-side-sub">
            {project} · {list.length}
          </h3>
          {list.map((wait) =>
            wait.answer ? (
              <HqPlusLog key={wait.id} items={[wait.answer]} flashId={null} ctx={ctx} />
            ) : (
              <HqPlusWeWaitCard key={wait.id} wait={wait} actions={actions} />
            )
          )}
        </section>
      ))}
    </div>
  )
}

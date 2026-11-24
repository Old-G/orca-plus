// Custom build (hq-dm-default-project, owner 24.11): routing.yaml names people as HQ does; the ledger
// knows a DM by the Slack id of the person in it.
import type { HqDmProjectRule } from '../../shared/hq-routing'
import type { PulsePerson } from '../../shared/pulse-types'

export type HqResolvedDmRule = { slackUserId: string; project: string }

/** Each named person's Slack id with the rule's project; the first rule naming a person wins. */
export function resolveHqDmProjectRules(
  rules: readonly HqDmProjectRule[],
  people: readonly Pick<PulsePerson, 'name' | 'slackUserId'>[]
): { rules: HqResolvedDmRule[]; unknown: string[] } {
  const resolved = new Map<string, string>()
  const unknown: string[] = []
  for (const rule of rules) {
    for (const named of rule.people) {
      const wanted = named.toLocaleLowerCase()
      const person = people.find(
        (candidate) =>
          candidate.slackUserId === named || candidate.name.toLocaleLowerCase() === wanted
      )
      if (!person?.slackUserId) {
        unknown.push(named)
      } else if (!resolved.has(person.slackUserId)) {
        resolved.set(person.slackUserId, rule.project)
      }
    }
  }
  return {
    rules: [...resolved].map(([slackUserId, project]) => ({ slackUserId, project })),
    unknown
  }
}

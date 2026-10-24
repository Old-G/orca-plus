// Custom build (hq-closed-loop): `orca hq person` and `orca hq who` — an agent asks who someone is,
// what they hold, where to write them and what is open between them and the owner, from the dossiers
// in HQ's `people/`, the org matrix and the pulse.
import { defineMethod } from '../core'
import {
  HqPersonLookupParams,
  HqWhoParams
} from '../../../../shared/rpc-contract/hq-journal-params'
import { findHqPeople, hqPeopleOfProject } from '../../../../shared/hq-people'
import { buildHqPeopleRows, buildHqPersonCard } from '../../../hq-today/hq-people'
import { peopleSources } from './hq-projects'

const MATCHES_MAX = 5
const DECISIONS_READ = 500

export const HQ_PEOPLE_METHODS = [
  defineMethod({
    name: 'hq.person',

    permission: 'workspace',
    params: HqPersonLookupParams,
    handler: async (params, { runtime }) => {
      const sources = await peopleSources(runtime)
      const matches = findHqPeople(buildHqPeopleRows(sources), params.query)
      const decisions = matches.length === 1 ? runtime.pulseListDecisions(DECISIONS_READ) : []
      return {
        query: params.query,
        total: matches.length,
        people: matches.slice(0, MATCHES_MAX).map((row) => ({
          row,
          card: matches.length === 1 ? buildHqPersonCard(row, { ...sources, decisions }) : null
        }))
      }
    }
  }),
  defineMethod({
    name: 'hq.who',

    permission: 'workspace',
    params: HqWhoParams,
    handler: async (params, { runtime }) => {
      const sources = await peopleSources(runtime)
      return {
        project: params.project,
        people: hqPeopleOfProject(buildHqPeopleRows(sources), params.project)
      }
    }
  })
]

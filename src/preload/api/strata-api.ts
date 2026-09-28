import type { StrataAdoptResult, StrataStatus } from '../../shared/strata-status'

export type StrataApi = {
  status: (repoIds: string[]) => Promise<Record<string, StrataStatus>>
  adopt: (repoId: string) => Promise<StrataAdoptResult>
}

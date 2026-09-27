import type { CommandSpec } from '../args'
import { GLOBAL_FLAGS } from '../args'

// Custom build (repo-groups-cli): group names for readers of `repo list`, e.g. the Strata HQ registry.

export const REPO_GROUPS_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['repo', 'groups'],
    summary: 'List project groups registered in Orca',
    usage: 'orca repo groups [--json]',
    allowedFlags: [...GLOBAL_FLAGS],
    notes: [
      'A repo belongs to the group whose id is its projectGroupId in `orca repo list --json`.'
    ]
  }
]

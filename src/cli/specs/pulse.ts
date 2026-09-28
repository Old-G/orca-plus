import type { CommandSpec } from '../args'
import { GLOBAL_FLAGS } from '../args'

// Custom build (pulse): agents record what they wait on, what was decided and what they want to
// send. A draft only waits for the owner's approval here; nothing in `orca pulse` sends it.

const PERSON_NOTE = '--person takes an id or a name; an unknown name is added as a new person.'

export const PULSE_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['pulse', 'wait', 'add'],
    summary: 'Record that someone waits on you (on-me) or you wait on someone (on-them)',
    usage:
      'orca pulse wait add --title <text> --direction <on-me|on-them> [--person <id|name>] [--project <slug>] [--detail <text>] [--due <date>] [--source <name>] [--source-ref <url|id>] [--json]',
    allowedFlags: [
      ...GLOBAL_FLAGS,
      'title',
      'direction',
      'person',
      'project',
      'detail',
      'due',
      'source',
      'source-ref'
    ],
    notes: [PERSON_NOTE, '--due takes an ISO date or date-time; --source defaults to agent.'],
    examples: [
      'orca pulse wait add --direction on-them --person Ann --title "Signed contract" --project app-a'
    ]
  },
  {
    path: ['pulse', 'wait', 'resolve'],
    summary: 'Close an open waiting as resolved, or as cancelled with --cancel',
    usage: 'orca pulse wait resolve <id> [--resolution <text>] [--cancel] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'id', 'resolution', 'cancel'],
    positionalArgs: ['id']
  },
  {
    path: ['pulse', 'wait', 'list'],
    summary: 'List waitings, open ones unless --status says otherwise',
    usage:
      'orca pulse wait list [--status <open|resolved|cancelled|all>] [--direction <on-me|on-them>] [--person <id|name>] [--project <slug>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'status', 'direction', 'person', 'project']
  },
  {
    path: ['pulse', 'decision', 'log'],
    summary: 'Log a decision so it shows in the decision journal',
    usage:
      'orca pulse decision log --title <text> [--body <text>] [--project <slug>] [--person <id|name>] [--source <name>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'title', 'body', 'project', 'person', 'source'],
    notes: [PERSON_NOTE]
  },
  {
    path: ['pulse', 'draft', 'add'],
    summary: 'Propose something to send; it waits for the owner to approve, edit or reject it',
    usage:
      'orca pulse draft add --kind <message|clickup-task|clickup-comment|other> --body <text> [--target <who|where>] [--title <text>] [--project <slug>] [--person <id|name>] [--fingerprint <key>] [--source <name>] [--source-ref <url|id>] [--json]',
    allowedFlags: [
      ...GLOBAL_FLAGS,
      'kind',
      'body',
      'target',
      'title',
      'project',
      'person',
      'fingerprint',
      'source',
      'source-ref'
    ],
    notes: [
      PERSON_NOTE,
      'Same --kind and --fingerprint as an earlier draft returns that draft, even a rejected one.'
    ]
  },
  {
    path: ['pulse', 'draft', 'list'],
    summary: 'List drafts, pending ones unless --status says otherwise',
    usage: 'orca pulse draft list [--status <pending|approved|rejected|sent|failed|all>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'status']
  },
  {
    path: ['pulse', 'person', 'show'],
    summary: 'Show a person with their open waitings and recent decisions',
    usage: 'orca pulse person show <id|name> [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'person'],
    positionalArgs: ['person']
  }
]

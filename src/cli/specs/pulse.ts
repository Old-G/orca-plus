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
      'source-ref',
      'force'
    ],
    notes: [
      PERSON_NOTE,
      '--due takes an ISO date or date-time; --source defaults to agent.',
      'An open waiting about the same person that says the same is returned instead of a new one (marked duplicate); --force adds anyway.'
    ],
    examples: [
      'orca pulse wait add --direction on-them --person Ann --title "Signed contract" --project app-a'
    ]
  },
  {
    // Custom build (hq-notes-dedup)
    path: ['pulse', 'wait', 'update'],
    summary: 'Change an open waiting: its text, detail or due date',
    usage:
      'orca pulse wait update <id> [--title <text>] [--detail <text|none>] [--due <date|none>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'id', 'title', 'detail', 'due'],
    positionalArgs: ['id'],
    notes: ['--due none clears the due date; --detail none clears the detail.']
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
    // Custom build (hq-ask)
    path: ['pulse', 'decision', 'list'],
    summary: 'Search decisions and approved or rejected outgoing messages, newest first',
    usage: 'orca pulse decision list [--query <text>] [--project <slug>] [--limit <n>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'query', 'project', 'limit'],
    notes: [
      '--query matches every word, case-insensitively, against the title, the text and where a message went (channel, person, task, chat, footer ref).',
      '--limit caps the printed rows (default 30); the search itself reads the latest 2000 decisions.'
    ]
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
    path: ['pulse', 'review', 'reply'],
    summary: 'Hand HQ the draft comment for a ClickUp change you looked into; the owner sends it',
    usage:
      'orca pulse review reply --task <clickup task id> --reply <comment> [--summary <one line>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'task', 'reply', 'summary'],
    notes: [
      'Only for a chat HQ started with «Разобрать»: the draft lands on its card, nothing is posted.'
    ]
  },
  {
    path: ['pulse', 'person', 'show'],
    summary: 'Show a person with their open waitings and recent decisions',
    usage: 'orca pulse person show <id|name> [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'person'],
    positionalArgs: ['person']
  }
]

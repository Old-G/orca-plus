import type { CommandSpec } from '../args'
import { GLOBAL_FLAGS } from '../args'

// Custom build (hq-plus-journal): HQ+'s journal for agents. Each chat reads its own room; a chat
// in the HQ repo (HQ+) reads every room's headings.

export const HQ_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['hq', 'events'],
    summary: "What happened in this chat's room and whose move it is, newest first",
    usage:
      'orca hq events [--since <24h|7d|ISO date>] [--project <slug>] [--needs <owner|agent|person|nobody|value>] [--kind <kind|family.*>] [--limit <n>] [--room <slug>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'since', 'project', 'needs', 'kind', 'limit', 'room'],
    notes: [
      'The room comes from the chat that runs the command; a chat in one room cannot read another.',
      'From HQ+ (a chat in the HQ repo) it lists every room by title only; --room <slug> shows one room in full and is recorded.',
      '--needs owner lists what is open on owner:decide, owner:approve or owner:reply; a full value such as person:<id> matches only itself.',
      "--kind 'approve.*' matches a whole family (quote it in the shell); --limit defaults to 50."
    ],
    examples: ['orca hq events --since 24h', "orca hq events --needs owner --kind 'approve.*'"]
  },
  {
    // Custom build (hq-plus-reports)
    path: ['hq', 'report'],
    summary: "Report this turn: what was done, the owner's question, what comes next",
    usage:
      'orca hq report --done <text> [--ask <question> --options <a|b|c>] [--next <text>] [--blocked-by <person>] [--link <url>]... [--address <project>/<task>] [--json]',
    allowedFlags: [
      ...GLOBAL_FLAGS,
      'done',
      'ask',
      'options',
      'next',
      'blocked-by',
      'link',
      'address'
    ],
    repeatableFlags: ['link'],
    notes: [
      'Run it once at the end of every turn in an Orca chat; it lands in the journal as chat.report.',
      'The first report names the thread <project>/<chat name>; --address names it yourself, and the name stays across handoffs.',
      "--ask makes it the owner's move; --blocked-by <name> makes it that person's."
    ],
    examples: [
      'orca hq report --done "Journal sync ships behind a switch" --next "Step 17.2: reports"',
      'orca hq report --done "Two ways to store addresses" --ask "Which one?" --options "table|column"'
    ]
  },
  {
    path: ['hq', 'thread'],
    summary: 'Everything said in one thread, oldest first, with what each answer replied to',
    usage: 'orca hq thread [<project>/<task>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'address'],
    positionalArgs: ['address'],
    notes: ["Without an address it shows this chat's own thread."]
  },
  {
    path: ['hq', 'whoami'],
    summary: 'Where this chat works: its room, project, thread address and task',
    usage: 'orca hq whoami [--json]',
    allowedFlags: [...GLOBAL_FLAGS]
  }
]

export const CHAT_COMMAND_SPECS: CommandSpec[] = [
  {
    // Custom build (hq-plus-reports)
    path: ['chat', 'send'],
    summary: 'Hand a message to the chat working on a thread; a closed chat is brought back',
    usage: 'orca chat send <project>/<task> <text> [--reply-to <journal id>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'address', 'text', 'reply-to'],
    positionalArgs: ['address', 'text'],
    notes: [
      "Only to a thread in this chat's room; HQ+ may write to any.",
      '--reply-to quotes the journal entry it answers, so the other chat sees what it replies to.'
    ]
  }
]

import type { CommandSpec } from '../args'
import { GLOBAL_FLAGS } from '../args'

// Custom build (hq-plus-journal): HQ+'s journal for agents. Each chat reads its own room; a chat
// in the HQ repo (HQ+) reads every room's headings.

export const HQ_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['hq', 'events'],
    summary: "What happened in this chat's room and whose move it is, newest first",
    usage:
      'orca hq events [--since <24h|7d|ISO date>] [--project <slug>] [--needs <owner|agent|person|nobody|value>] [--kind <kind|family.*>] [--query <words>] [--limit <n>] [--room <slug>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'since', 'project', 'needs', 'kind', 'query', 'limit', 'room'],
    notes: [
      'The room comes from the chat that runs the command; a chat in one room cannot read another.',
      'From HQ+ (a chat in the HQ repo) it lists every room by title only; --room <slug> shows one room in full and is recorded.',
      '--needs owner lists what is open on owner:decide, owner:approve or owner:reply; a full value such as person:<id> matches only itself.',
      "--kind 'approve.*' matches a whole family (quote it in the shell); --limit defaults to 50.",
      '--query keeps rows holding every word in the title, text, project, thread or links; a root («анн») finds every form.',
      'In a room each entry shows its links (Slack, ClickUp, MR, file): cite those as the source.'
    ],
    examples: [
      'orca hq events --since 24h',
      "orca hq events --needs owner --kind 'approve.*'",
      'orca hq events --query "реактивац" --since 30d'
    ]
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
    // Custom build (hq-plus-routing)
    path: ['hq', 'route'],
    summary: 'What HQ/routing.yaml does now: fixing chats for the evening Codex findings',
    usage: 'orca hq route [--now] [--since <7d|ISO date>] [--run] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'now', 'since', 'run'],
    notes: [
      'Without --run it only lists what it would do; Orca+ itself runs the rules every 5 minutes.',
      "--now ignores the rule's hour and the Claude limit; --run carries the actions out at once and implies --now.",
      "--since replaces the rules' since, to see what they would have done over the past."
    ],
    examples: ['orca hq route', 'orca hq route --now --since 2026-10-22']
  },
  {
    path: ['hq', 'settle'],
    summary:
      'Close a journal row this chat was handed: fixed (with the commit) or not needed (with why)',
    usage: 'orca hq settle <id> (--done [--commit <sha>] | --dropped --why <text>) [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'id', 'done', 'dropped', 'commit', 'why'],
    positionalArgs: ['id'],
    notes: ['A Codex finding handed to a «Codex: починить» chat closes this way, one per finding.'],
    examples: [
      'orca hq settle e-0193… --done --commit 1a2b3c4d5e',
      'orca hq settle e-0193… --dropped --why "Intended: the cap is per order"'
    ]
  },
  {
    // Custom build (hq-plus-context)
    path: ['hq', 'context'],
    summary:
      "A project's card in at most 60 lines: plan step, who we wait for, decisions, chats, where things are",
    usage: 'orca hq context [<project>] [--session-start] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'project', 'session-start'],
    positionalArgs: ['project'],
    notes: [
      "Without a project it shows this chat's own; a chat reads only projects of its room.",
      'Each block names its source and age; «⚠ устарело» marks a source too old to trust as is.',
      '--session-start prints what a new chat is told: the room notes (HQ/workspaces/<room>/context.md) and the card.'
    ],
    examples: ['orca hq context', 'orca hq context acme-billing']
  },
  {
    path: ['hq', 'step'],
    summary: "Tick a step of the project's plan (HQ/plans/<project>.md) as done, or open it again",
    usage: 'orca hq step <id> (--done | --undo) [--project <slug>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'id', 'done', 'undo', 'project'],
    positionalArgs: ['id'],
    notes: ['The id is the step number the plan shows (2.3), or #n for an unnumbered step.'],
    examples: ['orca hq step 2.3 --done']
  },
  {
    path: ['hq', 'where'],
    summary: 'Which source answers such a question, from the knowledge map HQ/wiki/where.md',
    usage: 'orca hq where <question> [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'question'],
    positionalArgs: ['question'],
    examples: ['orca hq where "кто кому что должен"']
  },
  {
    path: ['hq', 'workspace', 'add'],
    summary: 'A new room: HQ/workspaces/<slug>/workspace.yaml and a context.md to fill in',
    usage:
      'orca hq workspace add <name> [--slug <slug>] [--color <#rrggbb>] [--messenger <slack|…>] [--tasks <clickup|…>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'name', 'slug', 'color', 'messenger', 'tasks'],
    positionalArgs: ['name'],
    notes: ['Projects join a room by its groups or projects lists in workspace.yaml.'],
    examples: ['orca hq workspace add "Acme" --color "#22c55e" --messenger slack --tasks jira']
  },
  {
    // Custom build (hq-plus-sessions)
    path: ['hq', 'dispatch'],
    summary:
      'Hand work to a thread: its chat continues it, a new chat takes it over, or it waits in the queue',
    usage: 'orca hq dispatch <project>/<task> --prompt <text> [--dry-run] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'address', 'prompt', 'dry-run'],
    positionalArgs: ['address'],
    notes: [
      'Continues the chat on the thread while its context is under 60% and it was active in the last 12 h; otherwise a new chat starts there with the last report and the thread.',
      'A chat the owner is in, or one mid-turn, is not handed work; nor does a project with two live chats get a third, or a new chat start while five questions wait for the owner — the work waits in the queue.',
      'Settings → Workspace → «Session dispatcher»: Off, Report only (writes what it would do to the journal; the default) or On.'
    ],
    examples: ['orca hq dispatch acme-api/refunds --prompt "Add the partial-refund cap" --dry-run']
  },
  {
    path: ['hq', 'sessions'],
    summary:
      'The chats now — thread, state, context, the owner in it — and what the dispatcher would do',
    usage: 'orca hq sessions [--run] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'run'],
    notes: [
      'Lists queued work that can go, handoffs nobody took up, and threads with open work but no chat.',
      '--run carries it out now, as Orca+ does every two minutes when the dispatcher is on.'
    ]
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

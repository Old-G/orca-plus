import { COMPUTER_WAIT_DEFAULT_TIMEOUT_MS } from '../../shared/computer/computer-wait-timeout'

// File focus differs from terminal create's shared --focus help.
const FILE_OPEN_FOCUS_HELP =
  "--focus                Bring the user to the file (switches Orca's window to its worktree)"

const BOT_ITEM_TITLE_HELP = "--title <text>         The item's title"

const AGENT_ID_FLAG_HELP =
  "--id <id>              The agent's orca_session_id: ID; also accepted positionally"

const SKILLS_FORCE_FLAG_HELP =
  '--force                Replace skipped copies where possible, moving each to ~/.agents/.orca-skill-backups first.'

// Custom build (pulse-next, C1): `orca pulse` and `orca hq report` reuse flag names that mean something
// else in terminal commands (--title is a tab title there, --direction a scroll direction, --force a
// worktree removal) and left the rest bare; say what each one means here.
const PULSE_PERSON = '--person <id|name>     The person; an unknown name is added as a new person'
const PULSE_PROJECT = '--project <slug>       HQ project slug the record belongs to'
const PULSE_SOURCE = '--source <name>        Who recorded it (default agent)'
const PULSE_WAIT_DIRECTION =
  '--direction <on-me|on-them> on-them: you wait on someone; on-me: someone waits on you'

const PULSE_AND_HQ_FLAG_HELP: Record<string, Record<string, string>> = {
  'pulse wait add': {
    title: '--title <text>         What you wait for (or what waits on you), in one line',
    direction: PULSE_WAIT_DIRECTION,
    person: PULSE_PERSON,
    project: PULSE_PROJECT,
    detail: '--detail <text>        The question or context in full',
    next: '--next <text>          What you do once the answer comes; handed to your chat with it',
    due: '--due <date>           ISO date or date-time the answer is due',
    source: PULSE_SOURCE,
    'source-ref': '--source-ref <url|id>  Link or id of where it came from (message, task)',
    force: '--force                Add it even if an open waiting already says the same'
  },
  'pulse wait update': {
    title: '--title <text>         New one-line text of the waiting',
    detail: '--detail <text|none>   New detail; none clears it',
    next: '--next <text|none>     New next step; none clears it',
    due: '--due <date|none>      New due date; none clears it'
  },
  'pulse wait resolve': {
    resolution: '--resolution <text>    One line on how it ended',
    cancel: '--cancel               Close it as cancelled, not as resolved'
  },
  'pulse wait list': {
    status: '--status <open|resolved|cancelled|all> Which waitings (default open)',
    direction: PULSE_WAIT_DIRECTION,
    person: PULSE_PERSON,
    project: PULSE_PROJECT
  },
  'pulse decision log': {
    title: '--title <text>         The decision in one line',
    body: '--body <text>          Why, and what follows from it',
    person: PULSE_PERSON,
    project: PULSE_PROJECT,
    source: PULSE_SOURCE
  },
  'pulse decision list': {
    query: '--query <text>        Words the title, text or destination must all contain',
    project: PULSE_PROJECT,
    limit: '--limit <n>            Rows to print (default 30)'
  },
  'pulse draft add': {
    title: '--title <text>         Short title of the draft',
    body: '--body <text>          The text to send',
    target: '--target <who|where>   A Slack user or channel, a ClickUp list or task',
    person: PULSE_PERSON,
    project: PULSE_PROJECT,
    source: PULSE_SOURCE
  },
  'hq report': {
    done: '--done <text>          What was done this turn, in one line',
    ask: "--ask <question>       Your question to the owner; makes it the owner's move",
    options: '--options <a|b|c>     Answers to offer with --ask',
    next: '--next <text>          What comes next',
    'blocked-by': "--blocked-by <name>  The person you wait on; makes it that person's move",
    link: '--link <url>           A link for the report; repeat for several',
    address: '--address <project>/<task> Name the thread yourself (default: from the chat name)'
  }
}

const COMMAND_SCOPED_FLAG_HELP: Record<string, Record<string, string>> = {
  'bot item add': {
    title: BOT_ITEM_TITLE_HELP,
    for: '--for bot:<name>       Make the item for another bot'
  },
  'bot item set': {
    title: BOT_ITEM_TITLE_HELP,
    comment: '--comment <text>       Add a comment with this change',
    'expected-version': '--expected-version <n> Only write if the item is still at this version'
  },
  'bot item comment': { text: "--text <text>          The comment's text" },
  'bot item link': { ref: '--ref <ref>            A worker, PR, URL or file to link' },
  'bot item list': { cursor: '--cursor <c>           Cursor printed with the previous page' },
  ...PULSE_AND_HQ_FLAG_HELP,
  'agent list': {
    state: '--state <state>        Only agents in this state: working, blocked, waiting or done'
  },
  'agent show': { id: AGENT_ID_FLAG_HELP },
  'agent launch': {
    task: '--task <plan>:<row>|none Lock this plan row to the new chat (default: the row a Lead brief names)'
  },
  'agent read': {
    id: AGENT_ID_FLAG_HELP,
    limit: '--limit <n>            Newest entries to return (default 20, at most 100)'
  },
  'extension reload': {
    'extension-id':
      '--extension-id <id>   Installed unpacked extension ID; also accepted positionally',
    path: '--path <folder>        Source folder of exactly one installed unpacked extension'
  },
  'reference add': {
    url: '--url <url-or-jira-key> Full review/issue URL or Jira key; use positionals or repeated --url',
    'reference-site': '--reference-site <id> Jira site for bare keys; see orca jira connection'
  },
  'reference remove': {
    url: '--url <url>            Full review or issue URL; pass all URLs positionally or all as repeated --url',
    key: '--key <key>            Opaque key from reference list; repeat for several'
  },
  'computer get-app-state': {
    'element-index':
      '--element-index <n>   Read only this element and its descendants, including any the window snapshot cut off',
    query:
      '--query <text>        Show only elements whose line contains this text, with their ancestors'
  },
  'computer launch-app': {
    activate: '--activate            Start the app in front; only when the user asked for it'
  },
  'computer wait': {
    text: '--text <text>          Wait until an element line contains this text',
    enabled:
      '--enabled <text>       Wait until elements containing this text exist and none is disabled',
    'window-title':
      "--window-title <text>  Wait until one of the app's windows has this in its title",
    timeout: `--timeout <ms>         How long to wait before failing with wait_timeout (default ${COMPUTER_WAIT_DEFAULT_TIMEOUT_MS})`
  },
  'reference find': {
    query: '--query <url-or-key>   Full URL or native issue key such as STA-1234',
    repo: '--repo <selector>      Filter by workspace repository membership',
    'include-archived': '--include-archived     Include archived workspaces',
    limit: '--limit <n>            Maximum matching workspaces (default 50)'
  },
  'worktree create': {
    task: '--task <plan>:<row>|none Lock this plan row to the new chat (default: the row a Lead brief names)',
    branch: '--branch <name>        Git branch name to use instead of the prefixed default',
    reference:
      '--reference <url-or-jira-key> Attach an issue/review URL or Jira key; repeat for several',
    'reference-site': '--reference-site <id> Jira site for bare keys; see orca jira connection',
    pr: '--pr <number>          Linked GitHub pull request number',
    'gitlab-issue': '--gitlab-issue <number|url> Linked GitLab issue in the source project',
    'gitlab-mr': '--gitlab-mr <number|url> Linked GitLab merge request in the source project'
  },
  'skills get': {
    full: '--full                 Print the full guide with bundled references',
    reference: '--reference <name>     Print one bundled reference by name',
    references: '--references           List the bundled reference names for a topic'
  },
  'plugin create': {
    template: '--template <name>      Template to scaffold from (see Usage)',
    publisher: '--publisher <name>     Repository owner; only for Orca older than 1.4.246',
    id: '--id <id>              Plugin id (default: the folder name)',
    name: '--name <display name>  Plugin name shown in Orca'
  },
  'environment update': {
    force: '--force                Restart over running terminals instead of deferring the update',
    yes: '--yes                  With --force, accept that uncounted terminals the server runs itself end'
  },
  'environment recover': {
    'accept-changed-state':
      '--accept-changed-state Restore the prelaunch snapshot over state a rejected build changed',
    yes: '--yes                  Confirm discarding what the rejected build changed'
  },
  'environment stop': {
    yes: '--yes                  Confirm stopping the server and unlinking it from this machine'
  },
  'file open': {
    line: '--line <n>             Cursor line (1-based)',
    column: '--column <n>           Cursor column (1-based; requires --line)',
    focus: FILE_OPEN_FOCUS_HELP
  },
  'file diff': {
    focus: FILE_OPEN_FOCUS_HELP
  },
  'file open-changed': {
    focus: FILE_OPEN_FOCUS_HELP
  },
  'repo hide': {
    host: "--host <host>          Which host's copy to hide: local, ssh:<target-id>, runtime:<id>, or a host name"
  },
  'repo unhide': {
    host: "--host <host>          Which host's copy to show: local, ssh:<target-id>, runtime:<id>, or a host name"
  },
  'skills install': {
    agent: '--agent <names>        Comma-separated install targets; default is detected agents',
    force: SKILLS_FORCE_FLAG_HELP
  },
  'skills update': {
    force: SKILLS_FORCE_FLAG_HELP
  },
  'orchestration check': {
    format: '--format               Also render the returned rows as local text'
  },
  'orchestration run-show': {
    removed: '--removed              List the Tasks, Dispatches and workers removed from this Run',
    cursor: '--cursor <cursor>      Cursor printed by the previous page of removed work'
  },
  'worktree set': {
    unread: '--unread               Mark the workspace unread in the sidebar',
    read: '--read                 Mark the workspace read, clearing the unread dot'
  },
  search: {
    query: '--query <text>         Search text; also accepted as the positional argument',
    scope: '--scope <corpus>       conversation (user and assistant turns) or all (default)',
    fresh: '--fresh                Wait up to 5s for the host to reconcile its index first',
    limit: '--limit <n>            Hits per page (default 20, maximum 100)',
    cursor: '--cursor <cursor>      Opaque cursor printed by the previous page of this search',
    agent: '--agent <id>           Restrict to one agent; repeat for several',
    path: '--path <path>          Restrict to an execution-host path; repeat for several',
    since: '--since <iso>          Only sessions updated at or after this ISO 8601 timestamp',
    sort: '--sort <order>         relevance (default) or newest',
    debug: '--debug                Include the planner route the host used',
    'index-status': '--index-status         Report the index instead of searching'
  },
  ports: {
    all: '--all                  List every listener on the workspace host, not just this workspace'
  },
  snapshot: {
    interactive:
      '--interactive          Only interactive elements (buttons, inputs, links); no page text',
    compact: '--compact              Drop empty structural nodes',
    depth: '--depth <n>            Limit the tree to n levels',
    selector: '--selector <css>       Snapshot only the element matching this CSS selector',
    urls: '--urls                 Include link URLs',
    delta: '--delta                Return only what changed since the last --delta snapshot',
    full: '--full                 Return the whole tree and reset the --delta baseline'
  },
  screenshot: {
    'if-changed':
      '--if-changed           Skip saving when the page looks the same as the last capture',
    annotate: '--annotate             Label interactive elements; label [N] is ref @eN'
  },
  exec: {
    command: '--command <text>       agent-browser command and arguments, e.g. "get text @e3"'
  },
  wait: {
    selector: '--selector <sel>       Wait for an element by ref or CSS selector',
    timeout: '--timeout <ms>         How long to wait for the condition, or a plain pause',
    text: '--text <text>          Wait until this text appears on the page',
    url: '--url <pattern>        Wait until the page URL contains this text or matches a glob',
    load: '--load <state>         Wait for load or domcontentloaded (networkidle only on quiet pages)',
    fn: '--fn <js>              Wait until this JavaScript expression is truthy',
    state: '--state <state>        With --selector, wait for hidden or visible'
  },
  download: {
    selector: '--selector <ref>       Element ref or CSS selector of the download link',
    path: '--path <path>          File path to save the download to'
  }
}

export function formatCommandScopedFlagHelp(command: string, flag: string): string | undefined {
  return COMMAND_SCOPED_FLAG_HELP[command]?.[flag]
}

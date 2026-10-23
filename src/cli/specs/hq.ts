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
    path: ['hq', 'whoami'],
    summary: 'Where this chat works: its room, project, thread address and task',
    usage: 'orca hq whoami [--json]',
    allowedFlags: [...GLOBAL_FLAGS]
  }
]

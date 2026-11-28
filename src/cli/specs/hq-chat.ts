// Custom build (hq-plus-reports, hq-lead-of): `orca chat send` and `orca hq lead`.
import type { CommandSpec } from '../discovery/command-spec'
import { CLI_GLOBAL_FLAGS as GLOBAL_FLAGS } from '../../shared/cli/cli-argument-boundary'

export const HQ_CHAT_COMMAND_SPECS: CommandSpec[] = [
  {
    // Custom build (hq-lead-of, A1)
    path: ['hq', 'lead'],
    summary: "The Lead of this chat's plan now: its address, sessionId and whether it is open",
    usage: 'orca hq lead [--plan <file>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'plan'],
    notes: [
      'Read from the «Lead chat:» line of the plan in HQ/runs that names this chat (its address or sessionId); --plan names the plan instead.',
      'A Lead that handed off is followed to the chat that continues it. A Lead handover rewrites the line by itself, so the answer is the Lead now.',
      '`orca chat send lead "…"` sends to the same chat; a worker never needs to look the address up.'
    ],
    examples: ['orca hq lead', 'orca hq lead --plan 2026-11-28-acme-refunds --json']
  },
  {
    // Custom build (hq-plus-reports)
    path: ['chat', 'send'],
    summary: 'Hand a message to the open chat working on a thread',
    usage:
      'orca chat send <project>/<task>|<session id>|lead <text> [--reply-to <journal id>] [--revive] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'address', 'text', 'reply-to', 'revive'],
    booleanFlags: ['revive'],
    positionalArgs: ['address', 'text'],
    notes: [
      // Custom build (chat-send-anywhere)
      'To a chat of any room, by its thread address or its sessionId (`orca hq sessions --json` lists both).',
      // Custom build (hq-lead-of, A1)
      "`lead` is the Lead of this chat's plan now, as `orca hq lead` shows it.",
      // Custom build (chat-send-live, A2)
      'Only an open chat takes it. A closed one is refused with the open chats of its project; --revive brings it back. An address with two open chats is refused too: send to one by its sessionId.',
      'A chat in the middle of its turn gets the message queued, when that turn ends.',
      '--reply-to quotes the journal entry it answers, so the other chat sees what it replies to.'
    ]
  }
]

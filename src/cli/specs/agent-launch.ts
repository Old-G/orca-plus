import type { CommandSpec } from '../args'
import { GLOBAL_FLAGS } from '../args'

// Custom build (agent-launch-cli): the CLI face of `agent.launch`, which picks native chat or a
// terminal from the user's defaults — `terminal create --command claude` is always a terminal.
export const AGENT_LAUNCH_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['agent', 'launch'],
    summary: 'Start an agent in an existing worktree the way the Orca app does',
    usage:
      'orca agent launch --worktree <selector> --agent <id> [--prompt <text>] [--subscription <id>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'worktree', 'agent', 'prompt', 'subscription'],
    notes: [
      'Orca picks the surface from your settings: a native chat when agent tabs open in chat by default and the agent supports it, otherwise a terminal. The reply says which one and why.',
      '--prompt is submitted as the first message.',
      '--subscription (Claude): the Claude subscription id from Settings → Accounts, or `base` for the main sign-in; absent = the default subscription.',
      'Use `orca terminal create --command <agent>` when you need a terminal specifically.'
    ],
    examples: [
      'orca agent launch --worktree active --agent claude --prompt "Continue from the plan"',
      'orca agent launch --worktree path:/repo --agent claude --json'
    ]
  }
]

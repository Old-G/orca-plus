// Custom build (hq-lead-reassign): what `orca hq reassign` refuses before it moves anything. T13 (25.11):
// `none` on either side — chats that have no Lead are taken (`--from none`, or no --from), or chats are
// left with no Lead (`--to none`, the undo).
// Why `from` absent counts as none and blank does not: the CLI sends no --from as absent; the RPC
// schema refuses a blank or non-string one before it gets here.
import { HQ_REASSIGN_NO_LEAD } from '../../shared/hq-chat-links'

function isNone(ref: string | undefined): boolean {
  return ref?.trim().toLowerCase() === HQ_REASSIGN_NO_LEAD
}

/** Which side is no Lead; throws on a request that cannot work with none. */
export function hqReassignNoLeadSides(request: {
  from?: string
  to?: string
  chats?: readonly string[]
  plans?: readonly string[]
}): { fromNone: boolean; toNone: boolean } {
  const fromNone = request.from === undefined || isNone(request.from)
  const toNone = isNone(request.to)
  if (fromNone && toNone) {
    throw new Error('--from and --to cannot both be none.')
  }
  if ((fromNone || toNone) && !request.chats?.length) {
    throw new Error(
      fromNone
        ? 'Name the old Lead with --from <project>/<task>|<session id>, or the chats that have no Lead with --chats <a,b>.'
        : '--to none takes --chats <a,b>: the chats to leave with no Lead.'
    )
  }
  if ((fromNone || toNone) && request.plans?.length) {
    throw new Error(
      "--plans moves a plan's «Lead chat:» line; with none on one side there is none to move."
    )
  }
  return { fromNone, toNone }
}

/** Each asked chat (by key) fits the move: under the old Lead, or, with none, under no Lead. */
export function hqReassignCheckAsked(input: {
  asked: ReadonlySet<string> | null
  /** The old Lead's key; null for none. */
  from: string | null
  children: readonly string[]
  leadOf: (key: string) => string | undefined
}): void {
  const { from } = input
  for (const key of input.asked ?? []) {
    const lead = input.leadOf(key)
    if (!from && lead) {
      throw new Error(
        `${key} has a Lead: ${lead}; move it with --from ${lead}, or leave it where it is.`
      )
    }
    if (from && !input.children.includes(key)) {
      throw new Error(`${key} is not a chat of ${from}; \`orca hq reassign --dry-run\` lists them.`)
    }
  }
}

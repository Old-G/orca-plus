// Custom build (hq-chat-roles, owner 14.11): a chat's role in a lead's work — lead, sub-lead, worker or
// reviewer. It is set when the chat is launched (`orca agent launch --role`), kept by Orca+, handed to
// the chat's process as ORCA_CHAT_ROLE so hooks need not guess from the prompt, and shown in HQ+.

export const HQ_CHAT_ROLES = ['lead', 'sublead', 'worker', 'review'] as const
export type HqChatRole = (typeof HQ_CHAT_ROLES)[number]

/** The chat's process sees its role here; absent for a chat launched without one. */
export const ORCA_CHAT_ROLE_ENV = 'ORCA_CHAT_ROLE'

/** The launch option the CLI's `--role` travels in to the host. */
export const HQ_CHAT_ROLE_SESSION_OPTION = 'orcaChatRole'

const LABEL: Record<HqChatRole, string> = {
  lead: 'LEAD',
  sublead: 'SUB-LEAD',
  worker: 'W',
  review: 'REVIEW'
}

const ADDRESS_PREFIX: Record<HqChatRole, string> = {
  lead: 'lead',
  sublead: 'sublead',
  worker: 'w',
  review: 'review'
}

export function isHqChatRole(value: unknown): value is HqChatRole {
  return typeof value === 'string' && (HQ_CHAT_ROLES as readonly string[]).includes(value)
}

/** The role's label in titles: LEAD, SUB-LEAD, W, REVIEW. */
export function hqChatRoleLabel(role: HqChatRole): string {
  return LABEL[role]
}

/** The first word of a role chat's task in its address: lead, sublead, w, review. */
export function hqChatRoleAddressPrefix(role: HqChatRole): string {
  return ADDRESS_PREFIX[role]
}

// Why a separator is required: «W · task» is a label, «Write the tests» is not.
const LEADING_LABEL = /^\s*(?:lead|sub-?lead|w|worker|review)\s*[·:|]\s*/i

/** A chat name without a leading role label («W · », «LEAD · », «Sub-lead: »). */
export function hqStripRoleLabel(name: string): string {
  return name.replace(LEADING_LABEL, '')
}

/** A role chat's task as its address names it: the name without its label, up to its first sentence end. */
export function hqChatRoleTask(role: HqChatRole, name: string): string {
  const bare = hqStripRoleLabel(name).trim()
  const end = bare.search(/[.!?…](?=\s)|\n/)
  const task = (end === -1 ? bare : bare.slice(0, end)).trim()
  return `${ADDRESS_PREFIX[role]} ${task}`.trim()
}

/** `base`, else `base-2`, `base-3`… — the first one `taken` does not hold. */
export function hqUniqueAddress(base: string, taken: (address: string) => boolean): string {
  if (!taken(base)) {
    return base
  }
  for (let suffix = 2; suffix < 1000; suffix += 1) {
    const next = `${base}-${suffix}`
    if (!taken(next)) {
      return next
    }
  }
  return `${base}-${Date.now().toString(36)}`
}

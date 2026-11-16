// Custom build (hq-lead-batch, owner 14.11): messages from other chats to a chat launched with the
// role `lead` are held and handed over as one message — every turn re-reads the Lead's whole
// context, and the native chat's queue gives each queued message a turn of its own. A held batch
// goes 10 minutes after its first message, later if the Lead is still in a turn then (what arrives
// meanwhile joins it), and at once with a message whose first line is NEEDS DECISION or BLOCKED.

/** In userData: the held messages, so a restart of Orca+ does not lose them. */
export const HQ_LEAD_BATCH_FILE = 'hq-lead-batch.json'
export const HQ_LEAD_BATCH_WINDOW_MS = 10 * 60_000
/** How often a batch that is due checks again whether its Lead finished the turn. */
export const HQ_LEAD_BATCH_BUSY_STEP_MS = 30_000
/** Why: after a restart the chat host and its records come up a little after the main process. */
export const HQ_LEAD_BATCH_START_DELAY_MS = 30_000
/** Why: a Lead that took nothing for this many windows is gone; the owner is told instead. */
export const HQ_LEAD_BATCH_MAX_TRIES = 3

const URGENT = /^(NEEDS DECISION|BLOCKED)\b/i

/** A report the Lead must see at once: its first line starts with NEEDS DECISION or BLOCKED. */
export function hqLeadUrgent(text: string): boolean {
  const first = text.split('\n').find((line) => line.trim() !== '') ?? ''
  return URGENT.test(first.trim())
}

export type HqLeadHeld = {
  /** The Lead's thread, the batch's key: a handoff's new chat takes it over, and the batch with it. */
  address: string
  /** The chat the first message was for; the batch goes there when no chat holds the thread. */
  sessionId: string
  /** Each message as it would have been delivered alone. */
  prompts: string[]
  since: number
  dueAt: number
  /** Deliveries that failed so far. */
  tries: number
}

function clock(at: number): string {
  const date = new Date(at)
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

/** One message for many: a single held message goes as it is. */
export function hqLeadBatchPrompt(prompts: string[], since: number): string {
  if (prompts.length === 1) {
    return prompts[0]
  }
  return [
    `Orca+ · ${prompts.length} messages to this Lead, held since ${clock(since)} and handed over in one turn:`,
    ...prompts
  ].join('\n\n')
}

export type HqLeadBatchDeps = {
  windowMs?: number
  /** True while the chat on the batch's thread is in a turn or waits on a prompt. */
  busy: (held: HqLeadHeld) => boolean
  /** Delivers the joined prompt, bringing a closed chat back; false keeps the batch held. */
  flush: (held: HqLeadHeld, prompt: string) => Promise<boolean>
  /** The Lead took nothing for HQ_LEAD_BATCH_MAX_TRIES windows: tell the owner, the batch goes. */
  giveUp: (held: HqLeadHeld, prompt: string) => void
  load: () => Promise<HqLeadHeld[]>
  /** Writes the whole list; writes run one after another, the last one wins. */
  save: (held: HqLeadHeld[]) => Promise<void>
  now: () => number
  /** Runs `run` after `ms`; returns what cancels it. */
  schedule: (run: () => void, ms: number) => () => void
  log: (message: string) => void
}

export type HqLeadBatch = {
  /** Settles once the batches saved before a restart are back; hold and take wait for it. */
  ready: Promise<void>
  /** Holds one message for the Lead's thread; returns when its batch goes at the latest. */
  hold: (address: string, sessionId: string, prompt: string) => { dueAt: number }
  /**
   * Takes the thread's held messages out to go now with an urgent one; null when none. They stay
   * in the saved file until `delivered` or `restore`, so a restart mid-delivery keeps them.
   */
  take: (address: string) => HqLeadHeld | null
  /** The taken messages reached the Lead: they leave the saved file. */
  delivered: (held: HqLeadHeld) => void
  /** Puts taken messages back in front of newer ones when their delivery failed. */
  restore: (held: HqLeadHeld) => void
  /** Picks up the batches saved before a restart; call once, right after creating — `ready` waits for it. */
  start: () => Promise<void>
}

export function parseHqLeadHeld(text: string): HqLeadHeld[] {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return []
  }
  if (!Array.isArray(value)) {
    return []
  }
  return value
    .filter(
      (item): item is HqLeadHeld =>
        typeof item === 'object' &&
        item !== null &&
        typeof item.sessionId === 'string' &&
        typeof item.address === 'string' &&
        Array.isArray(item.prompts) &&
        item.prompts.length > 0 &&
        item.prompts.every((prompt: unknown) => typeof prompt === 'string') &&
        typeof item.since === 'number' &&
        typeof item.dueAt === 'number'
    )
    .map((item) => ({ ...item, tries: typeof item.tries === 'number' ? item.tries : 0 }))
}

export function createHqLeadBatch(deps: HqLeadBatchDeps): HqLeadBatch {
  const windowMs = deps.windowMs ?? HQ_LEAD_BATCH_WINDOW_MS
  const held = new Map<string, HqLeadHeld>()
  // Why: a delivery can wait 15 s on a closed Lead coming back; until it lands, a restart must
  // still find these messages in the file (they come back as a held batch of their thread).
  const inFlight = new Set<HqLeadHeld>()
  const timers = new Map<string, () => void>()
  let started: (() => void) | null = null
  const ready = new Promise<void>((resolve) => {
    started = resolve
  })

  let writes = Promise.resolve()
  const save = (): void => {
    const snapshot = structuredClone([...held.values(), ...inFlight])
    writes = writes
      .then(() => deps.save(snapshot))
      .catch((error: unknown) => deps.log(`could not save held messages: ${String(error)}`))
  }

  const arm = (address: string, ms: number): void => {
    timers.get(address)?.()
    timers.set(
      address,
      deps.schedule(() => void fire(address), Math.max(0, ms))
    )
  }

  const disarm = (address: string): void => {
    timers.get(address)?.()
    timers.delete(address)
  }

  const fire = async (address: string): Promise<void> => {
    timers.delete(address)
    const batch = held.get(address)
    if (!batch) {
      return
    }
    if (deps.busy(batch)) {
      arm(address, HQ_LEAD_BATCH_BUSY_STEP_MS)
      return
    }
    held.delete(address)
    inFlight.add(batch)
    const prompt = hqLeadBatchPrompt(batch.prompts, batch.since)
    const delivered = await deps.flush(batch, prompt).catch((error: unknown) => {
      deps.log(`batch for ${address} failed: ${String(error)}`)
      return false
    })
    inFlight.delete(batch)
    if (delivered) {
      save()
      return
    }
    const tries = batch.tries + 1
    if (tries >= HQ_LEAD_BATCH_MAX_TRIES) {
      try {
        deps.giveUp({ ...batch, tries }, prompt)
        deps.log(`batch for ${address} not taken ${tries} times; handed to the owner`)
        save()
        return
      } catch (error) {
        // Why: the batch is the only copy of the joined messages; it stays until someone sees it.
        deps.log(`batch for ${address} could not reach the owner: ${String(error)}`)
      }
    }
    deps.log(`batch for ${address} not taken; tries again in ${windowMs / 60_000} min`)
    restore({ ...batch, tries, dueAt: deps.now() + windowMs })
  }

  const restore = (batch: HqLeadHeld): void => {
    inFlight.delete(batch)
    const later = held.get(batch.address)
    const merged: HqLeadHeld = later
      ? {
          ...batch,
          sessionId: later.sessionId,
          prompts: [...batch.prompts, ...later.prompts],
          since: Math.min(batch.since, later.since),
          dueAt: Math.min(batch.dueAt, later.dueAt),
          // Why: messages held after a failed try get the full count of tries of their own.
          tries: Math.min(batch.tries, later.tries)
        }
      : batch
    held.set(batch.address, merged)
    save()
    arm(batch.address, merged.dueAt - deps.now())
  }

  return {
    ready,
    hold(address, sessionId, prompt) {
      const at = deps.now()
      const known = held.get(address)
      if (known) {
        known.prompts.push(prompt)
        known.sessionId = sessionId
        save()
        return { dueAt: known.dueAt }
      }
      const batch: HqLeadHeld = {
        address,
        sessionId,
        prompts: [prompt],
        since: at,
        dueAt: at + windowMs,
        tries: 0
      }
      held.set(address, batch)
      save()
      arm(address, windowMs)
      return { dueAt: batch.dueAt }
    },
    take(address) {
      const batch = held.get(address) ?? null
      if (batch) {
        held.delete(address)
        inFlight.add(batch)
        disarm(address)
      }
      return batch
    },
    delivered(batch) {
      if (inFlight.delete(batch)) {
        save()
      }
    },
    restore,
    async start() {
      try {
        const saved = await deps.load().catch((error: unknown) => {
          deps.log(`could not read held messages: ${String(error)}`)
          return []
        })
        const earliest = deps.now() + HQ_LEAD_BATCH_START_DELAY_MS
        for (const batch of saved) {
          restore({ ...batch, dueAt: Math.max(batch.dueAt, earliest) })
        }
      } finally {
        started?.()
      }
    }
  }
}

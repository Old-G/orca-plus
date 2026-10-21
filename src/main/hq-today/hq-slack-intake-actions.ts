// Custom build (hq-slack-intake): what the owner's buttons on a «To work» card do in main — keep it
// in Notes with its source (Later), or close it once it went to a chat or was skipped.
import {
  HQ_INTAKE_KIND,
  HQ_INTAKE_NOTE_SOURCE,
  hqIntakeKey,
  hqIntakeNote,
  readHqIntake,
  type HqIntake
} from '../../shared/hq-slack-intake'
import type {
  PulseInboxItem,
  PulsePerson,
  PulseWaiting,
  PulseWaitingInput
} from '../../shared/pulse-types'

export type HqIntakeActionDeps = {
  openItems: () => PulseInboxItem[]
  people: () => PulsePerson[]
  addPerson: (name: string, slackUserId: string) => PulsePerson
  openWaitings: () => PulseWaiting[]
  addWaiting: (input: PulseWaitingInput) => PulseWaiting
  closeWaiting: (id: string, resolution: string) => void
  markRead: (itemId: string) => void
  markDone: (itemId: string, action: string) => void
}

function itemIntake(deps: HqIntakeActionDeps, itemId: string): HqIntake | null {
  const item = deps
    .openItems()
    .find((entry) => entry.id === itemId && entry.kind === HQ_INTAKE_KIND)
  return item ? readHqIntake(item.refId) : null
}

function noteRef(intake: HqIntake): string {
  return `slack:${intake.channel}:${intake.ts}`
}

function savedNote(deps: HqIntakeActionDeps, intake: HqIntake): PulseWaiting | null {
  return (
    deps
      .openWaitings()
      .find(
        (waiting) =>
          waiting.source === HQ_INTAKE_NOTE_SOURCE && waiting.sourceRef === noteRef(intake)
      ) ?? null
  )
}

/** Later: a Notes line on the owner with the whole source; the card stays in the bell until handled. */
export function keepHqIntakeInNotes(
  deps: HqIntakeActionDeps,
  itemId: string,
  choice: { project: string | null; note: string }
): { ok: true } | { ok: false; error: string } {
  const intake = itemIntake(deps, itemId)
  if (!intake) {
    return { ok: false, error: 'This message was already handled.' }
  }
  if (!savedNote(deps, intake)) {
    // Why look up first: upserting by Slack id would rename the person Orca+ already knows.
    const person = intake.authorSlackId
      ? (deps.people().find((entry) => entry.slackUserId === intake.authorSlackId) ??
        deps.addPerson(intake.author, intake.authorSlackId))
      : null
    const { title, detail } = hqIntakeNote(intake, choice.note)
    deps.addWaiting({
      direction: 'on-me',
      title,
      detail,
      personId: person?.id ?? null,
      project: choice.project ?? intake.project,
      source: HQ_INTAKE_NOTE_SOURCE,
      sourceRef: noteRef(intake),
      allowDuplicate: true
    })
  }
  deps.markRead(itemId)
  return { ok: true }
}

/** Sent to a chat or skipped: the card closes, and so does its Notes line. */
export function closeHqIntake(
  deps: HqIntakeActionDeps,
  itemId: string,
  outcome: { action: 'sent' | 'skipped'; resolution: string }
): void {
  const intake = itemIntake(deps, itemId)
  const note = intake ? savedNote(deps, intake) : null
  if (note) {
    deps.closeWaiting(note.id, outcome.resolution)
  }
  deps.markDone(itemId, outcome.action)
}

/** The bell item a Notes line kept by Later belongs to. */
export function hqIntakeItemForNote(
  items: readonly PulseInboxItem[],
  sourceRef: string
): PulseInboxItem | null {
  const match = /^slack:([A-Z0-9]+):(\d+\.\d+)$/.exec(sourceRef)
  if (!match) {
    return null
  }
  const key = hqIntakeKey({ channel: match[1], ts: match[2] })
  return items.find((item) => item.dedupeKey === key) ?? null
}

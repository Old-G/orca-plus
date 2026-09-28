// Custom build (pulse): people — one row per person, found again by their Slack or ClickUp id.
import type { SqliteRow } from '../../sqlite/sqlite-statement'
import type { PulsePerson, PulsePersonInput } from '../../../shared/pulse-types'
import type { PulseCore } from './pulse-core'
import { integer, optionalText, text } from './pulse-row-fields'

function toPerson(row: SqliteRow): PulsePerson {
  return {
    id: text(row, 'id'),
    name: text(row, 'name'),
    slackUserId: optionalText(row, 'slack_user_id'),
    clickupUserId: optionalText(row, 'clickup_user_id'),
    role: optionalText(row, 'role'),
    notes: optionalText(row, 'notes'),
    createdAt: integer(row, 'created_at'),
    updatedAt: integer(row, 'updated_at')
  }
}

export function getPerson(core: PulseCore, id: string): PulsePerson | null {
  const row = core.db.prepare('SELECT * FROM people WHERE id = ?').get(id)
  return row ? toPerson(row) : null
}

function findExisting(core: PulseCore, input: PulsePersonInput): PulsePerson | null {
  if (input.id) {
    return getPerson(core, input.id)
  }
  const row = core.db
    .prepare(
      'SELECT * FROM people WHERE (slack_user_id IS NOT NULL AND slack_user_id = ?) ' +
        'OR (clickup_user_id IS NOT NULL AND clickup_user_id = ?) LIMIT 1'
    )
    .get(input.slackUserId ?? null, input.clickupUserId ?? null)
  return row ? toPerson(row) : null
}

/** Creates the person, or updates the one with the same id, Slack id or ClickUp id. */
export function upsertPerson(core: PulseCore, input: PulsePersonInput): PulsePerson {
  return core.transaction(() => {
    const existing = findExisting(core, input)
    const now = core.clock.now()
    if (existing) {
      // Why: an absent field keeps what is known; only an explicit null clears it.
      const merged: PulsePerson = {
        ...existing,
        name: input.name,
        slackUserId: input.slackUserId === undefined ? existing.slackUserId : input.slackUserId,
        clickupUserId:
          input.clickupUserId === undefined ? existing.clickupUserId : input.clickupUserId,
        role: input.role === undefined ? existing.role : input.role,
        notes: input.notes === undefined ? existing.notes : input.notes,
        updatedAt: now
      }
      core.db
        .prepare(
          'UPDATE people SET name = ?, slack_user_id = ?, clickup_user_id = ?, role = ?, ' +
            'notes = ?, updated_at = ? WHERE id = ?'
        )
        .run(
          merged.name,
          merged.slackUserId,
          merged.clickupUserId,
          merged.role,
          merged.notes,
          now,
          merged.id
        )
      core.emit('person.updated', 'person', merged.id, merged)
      return merged
    }
    if (input.id) {
      throw new Error(`pulse: no person ${input.id}`)
    }
    const person: PulsePerson = {
      id: core.clock.newId(),
      name: input.name,
      slackUserId: input.slackUserId ?? null,
      clickupUserId: input.clickupUserId ?? null,
      role: input.role ?? null,
      notes: input.notes ?? null,
      createdAt: now,
      updatedAt: now
    }
    core.db
      .prepare(
        'INSERT INTO people (id, name, slack_user_id, clickup_user_id, role, notes, ' +
          'created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
      )
      .run(
        person.id,
        person.name,
        person.slackUserId,
        person.clickupUserId,
        person.role,
        person.notes,
        now,
        now
      )
    core.emit('person.added', 'person', person.id, person)
    return person
  })
}

/** Everyone, or those whose name contains `query` (case-insensitive), by name. */
export function listPeople(core: PulseCore, query?: string): PulsePerson[] {
  const rows = query
    ? core.db
        .prepare("SELECT * FROM people WHERE name LIKE ? ESCAPE '\\' ORDER BY name COLLATE NOCASE")
        .all(`%${query.replace(/[\\%_]/g, (c) => `\\${c}`)}%`)
    : core.db.prepare('SELECT * FROM people ORDER BY name COLLATE NOCASE').all()
  return rows.map(toPerson)
}

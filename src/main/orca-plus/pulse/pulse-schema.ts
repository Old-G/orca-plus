// Custom build (pulse): schema of orca-plus-pulse.db. A new version appends one step to STEPS;
// a step never edits an earlier one, so every database climbs the same ladder.
import type Database from '../../sqlite/sync-database'

const V1 = `
CREATE TABLE people (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slack_user_id TEXT,
  clickup_user_id TEXT,
  role TEXT,
  notes TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX people_slack ON people(slack_user_id) WHERE slack_user_id IS NOT NULL;
CREATE UNIQUE INDEX people_clickup ON people(clickup_user_id) WHERE clickup_user_id IS NOT NULL;

CREATE TABLE waitings (
  id TEXT PRIMARY KEY,
  direction TEXT NOT NULL CHECK (direction IN ('on-me', 'on-them')),
  person_id TEXT REFERENCES people(id) ON DELETE SET NULL,
  project TEXT,
  title TEXT NOT NULL,
  detail TEXT,
  source TEXT NOT NULL,
  source_ref TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'cancelled')),
  due_at INTEGER,
  resolution TEXT,
  created_at INTEGER NOT NULL,
  resolved_at INTEGER
);
CREATE INDEX waitings_by_status ON waitings(status, direction, created_at);

CREATE TABLE drafts (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('message', 'clickup-task', 'clickup-comment', 'other')),
  target TEXT,
  title TEXT,
  body TEXT NOT NULL,
  project TEXT,
  person_id TEXT REFERENCES people(id) ON DELETE SET NULL,
  source TEXT NOT NULL,
  source_ref TEXT,
  fingerprint TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'sent', 'failed')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX drafts_fingerprint ON drafts(kind, fingerprint) WHERE fingerprint IS NOT NULL;
CREATE INDEX drafts_by_status ON drafts(status, created_at);

CREATE TABLE decisions (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('decision', 'approval')),
  title TEXT NOT NULL,
  body TEXT,
  outcome TEXT CHECK (outcome IN ('approved', 'edited', 'rejected')),
  project TEXT,
  person_id TEXT REFERENCES people(id) ON DELETE SET NULL,
  draft_id TEXT REFERENCES drafts(id) ON DELETE SET NULL,
  source TEXT NOT NULL,
  decided_at INTEGER NOT NULL,
  mirrored_path TEXT,
  CHECK ((kind = 'approval') = (outcome IS NOT NULL))
);
CREATE INDEX decisions_by_time ON decisions(decided_at);

CREATE TABLE inbox (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  urgency TEXT NOT NULL DEFAULT 'normal' CHECK (urgency IN ('normal', 'urgent')),
  ref_kind TEXT,
  ref_id TEXT,
  actions TEXT NOT NULL DEFAULT '[]',
  dedupe_key TEXT,
  created_at INTEGER NOT NULL,
  read_at INTEGER,
  done_at INTEGER,
  done_action TEXT
);
CREATE UNIQUE INDEX inbox_open_dedupe ON inbox(dedupe_key)
  WHERE dedupe_key IS NOT NULL AND done_at IS NULL;
CREATE INDEX inbox_open ON inbox(done_at, created_at);

CREATE TABLE events (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  at INTEGER NOT NULL,
  kind TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  payload TEXT NOT NULL
);
`

// Custom build (outgoing-approval): the held agent tool call behind a gate draft, as JSON.
const V2 = `ALTER TABLE drafts ADD COLUMN payload TEXT;`

// Custom build (hq-waiting-replies): the chat that waits, and the latest answer from the person.
const V3 = `
ALTER TABLE waitings ADD COLUMN agent_session_id TEXT;
ALTER TABLE waitings ADD COLUMN pane_key TEXT;
ALTER TABLE waitings ADD COLUMN worktree_id TEXT;
ALTER TABLE waitings ADD COLUMN reply TEXT;
ALTER TABLE waitings ADD COLUMN reply_author TEXT;
ALTER TABLE waitings ADD COLUMN reply_ts TEXT;
ALTER TABLE waitings ADD COLUMN replied_at INTEGER;
ALTER TABLE waitings ADD COLUMN reply_delivered_at INTEGER;
`

// Custom build (hq-sent-history): where an approved call went and who sent it, as JSON.
const V4 = `ALTER TABLE decisions ADD COLUMN context TEXT;`

// Custom build (hq-feed): HQ's feed of outside events, one row per thing, updated in place.
const V5 = `
CREATE TABLE IF NOT EXISTS feed (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  kind TEXT NOT NULL,
  at INTEGER NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  url TEXT,
  project TEXT,
  person TEXT,
  seen_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS feed_at ON feed(at);
`

// Custom build (hq-feed-posts): the readable post a model wrote for a feed row; null until written.
// Why the DELETE: the first feed kept approved commands as «sent»; the collector re-adds real messages.
const V6 = `ALTER TABLE feed ADD COLUMN post TEXT;
DELETE FROM feed WHERE kind = 'sent';`

// Custom build (hq-reply-source-link): where the answer was said (Slack permalink, ClickUp comment).
const V7 = `ALTER TABLE waitings ADD COLUMN reply_link TEXT;`

// Custom build (hq-plus-journal): HQ+'s event journal, one row per thing that happened, its room
// first; and the agent sessions working on its threads. IF NOT EXISTS: older-version tests re-run it.
const V8 = `
CREATE TABLE IF NOT EXISTS journal (
  id TEXT PRIMARY KEY,
  at INTEGER NOT NULL,
  workspace TEXT NOT NULL,
  kind TEXT NOT NULL,
  project TEXT,
  address TEXT,
  session_id TEXT,
  person_id TEXT REFERENCES people(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  body TEXT,
  needs TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done', 'dropped')),
  reply_to TEXT,
  ref_kind TEXT,
  ref_id TEXT,
  links TEXT NOT NULL DEFAULT '[]',
  source TEXT NOT NULL,
  dedupe_key TEXT
);
CREATE INDEX IF NOT EXISTS journal_by_workspace ON journal(workspace, at);
CREATE INDEX IF NOT EXISTS journal_by_address ON journal(address, at);
CREATE INDEX IF NOT EXISTS journal_by_needs ON journal(needs, status);
CREATE INDEX IF NOT EXISTS journal_by_project ON journal(project, at);
CREATE UNIQUE INDEX IF NOT EXISTS journal_dedupe ON journal(dedupe_key);

CREATE TABLE IF NOT EXISTS sessions (
  session_id TEXT PRIMARY KEY,
  address TEXT,
  agent TEXT,
  worktree_id TEXT,
  workspace TEXT NOT NULL,
  project TEXT,
  state TEXT NOT NULL CHECK (state IN ('queued', 'working', 'waiting', 'done', 'closed')),
  context_pct INTEGER,
  opened_at INTEGER NOT NULL,
  last_activity_at INTEGER NOT NULL,
  closed_at INTEGER,
  parent_session_id TEXT,
  task_ref TEXT
);
CREATE INDEX IF NOT EXISTS sessions_by_address ON sessions(address, opened_at);
CREATE INDEX IF NOT EXISTS sessions_by_workspace ON sessions(workspace, last_activity_at);
`

const STEPS: readonly string[] = [V1, V2, V3, V4, V5, V6, V7, V8]

export const PULSE_SCHEMA_VERSION = STEPS.length

/** Brings the database up to PULSE_SCHEMA_VERSION; all steps or none. */
export function migratePulseSchema(db: Database.Database): void {
  const stored = Number(db.pragma('user_version', { simple: true }) ?? 0)
  if (stored > PULSE_SCHEMA_VERSION) {
    // Why: a newer Orca+ wrote this file; writing through an older schema could corrupt it.
    throw new Error(
      `orca-plus-pulse.db is version ${stored}, newer than this build's ${PULSE_SCHEMA_VERSION}`
    )
  }
  if (stored === PULSE_SCHEMA_VERSION) {
    return
  }
  db.exec('BEGIN IMMEDIATE')
  try {
    for (const step of STEPS.slice(stored)) {
      db.exec(step)
    }
    db.pragma(`user_version = ${PULSE_SCHEMA_VERSION}`)
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

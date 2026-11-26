// Custom build (pulse-hot-indexes): lookups HQ runs after every pulse write, which scanned a whole
// table without these — 20–900 ms each on a 400 MB file, ~85% of the main thread with a busy HQ:
// - an inbox key the owner already answered (`syncInboxKind`, per bell line, the open-only
//   `inbox_open_dedupe` cannot serve `done_at IS NOT NULL`);
// - one chat's reports (`kind` + `session_id`), open rows of a kind (`kind` + `status`), a kind since
//   a moment (`kind` + `at`), one source's rows (`source`);
// - the chats a session handed its work to (`sessions.parent_session_id`);
// - Custom build (t8b-feed-sql): HQ+'s feed on every reload — the week's newest rows (`at`), a week of
//   bell items (`inbox.created_at`) — and, so an `at` walk is not picked over them, one chat's rows
//   (`session_id`) and rows by status (`status`).
// Why outside the versioned steps: an index changes no data, so the build before this one still opens
// the file (a newer user_version is refused) and a rollback keeps HQ+ working.
export const PULSE_HOT_INDEXES = `
CREATE INDEX IF NOT EXISTS inbox_by_dedupe ON inbox(dedupe_key);
CREATE INDEX IF NOT EXISTS journal_by_kind_session ON journal(kind, session_id, at);
CREATE INDEX IF NOT EXISTS journal_by_kind_status ON journal(kind, status, at);
CREATE INDEX IF NOT EXISTS journal_by_kind_at ON journal(kind, at);
CREATE INDEX IF NOT EXISTS journal_by_source ON journal(source, at);
CREATE INDEX IF NOT EXISTS sessions_by_parent ON sessions(parent_session_id);
CREATE INDEX IF NOT EXISTS journal_by_at ON journal(at);
CREATE INDEX IF NOT EXISTS journal_by_session ON journal(session_id, at);
CREATE INDEX IF NOT EXISTS journal_by_status ON journal(status, at);
CREATE INDEX IF NOT EXISTS inbox_by_created ON inbox(created_at);
`

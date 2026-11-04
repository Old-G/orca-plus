# Review guide

Read before reviewing this repo, at ship time and in the evening run. Report bugs with a file and line as evidence; no style or cleanup.

A breakage here looks like:
- Classic HQ behaves differently after a change meant for HQ+ (an HQ+ path not gated by flavor or not off by default).
- A personal name, id, email, company or system name, or a `/Users/<name>/` path lands in this public repo, tests and prompts included.
- One event writes a second pulse journal row (a missing or unstable dedupe key, a retry that records again).
- A pulse DB migration with no way back: a step that drops, renames or rewrites existing tables, columns or rows. Additive steps are fine — an older build refusing a newer file is by design, and the ship's backup keeps the old app with its data.
- The outgoing-approval gate lets a message to a person or an irreversible action through without the owner's card. The gate reads commands as written and guards against an agent's mistakes: it must catch a delete or a message the text shows. A step an agent deliberately hides from it — a command name built from a variable, glob, brace or quotes, a script written and then run, a pipe into a shell — is outside what the gate promises (owner, 05.11); the gate never read those, with or without an exemption. Report a gate finding only when a command written out in plain text gets through.

Risky paths (a ship touching one is reviewed at once, whatever its size; test files aside):
- `src/main/orca-plus/outgoing-approval/` `src/shared/outgoing-approval/` `src/main/orca-plus/pulse/pulse-schema.ts` `src/main/orca-plus/pulse/pulse-core.ts` `src/main/orca-plus/pulse/pulse-journal.ts` `src/main/hq-routing/` `scripts/orca-plus-ship.sh`

// Custom build (google-mcp): the scopes Google's MCP servers list are narrower than the ones Orca
// asked for before (drive.readonly and drive.file, not drive). An account that allowed the broader
// scope keeps working until it reconnects: Google honours the broader one for the narrower.
const SCOPE = 'https://www.googleapis.com/auth/'

const COVERED_BY: Readonly<Record<string, readonly string[]>> = {
  [`${SCOPE}gmail.readonly`]: [`${SCOPE}gmail.modify`],
  [`${SCOPE}gmail.compose`]: [`${SCOPE}gmail.modify`],
  [`${SCOPE}calendar.events.readonly`]: [`${SCOPE}calendar.events`],
  [`${SCOPE}drive.readonly`]: [`${SCOPE}drive`],
  [`${SCOPE}drive.file`]: [`${SCOPE}drive`],
  [`${SCOPE}documents.readonly`]: [`${SCOPE}documents`],
  [`${SCOPE}spreadsheets.readonly`]: [`${SCOPE}spreadsheets`]
}

/** Whether the granted scopes allow this one, itself or through a broader scope. */
export function googleScopeGranted(granted: ReadonlySet<string>, scope: string): boolean {
  return granted.has(scope) || (COVERED_BY[scope] ?? []).some((broader) => granted.has(broader))
}

// Custom build (claude-limit-guard): the config folder each native chat's live Claude child runs in.
// A routed launch follows the account selected at spawn, so the record's accountHome can name a
// different account than the one the running child actually spends.

const launchHomes = new Map<string, { home: string; child: object }>()

export function noteClaudeChatLaunchHome(sessionId: string, home: string, child: object): void {
  launchHomes.set(sessionId, { home, child })
}

/** Only the child that noted the home forgets it: a newer child may already run for the chat. */
export function forgetClaudeChatLaunchHome(sessionId: string, child: object): void {
  if (launchHomes.get(sessionId)?.child === child) {
    launchHomes.delete(sessionId)
  }
}

/** The folder the chat's live child was launched in; undefined when no child is running. */
export function claudeChatLaunchHome(sessionId: string): string | undefined {
  return launchHomes.get(sessionId)?.home
}

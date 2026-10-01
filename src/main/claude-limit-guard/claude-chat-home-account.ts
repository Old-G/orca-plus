// Custom build (claude-limit-guard): the account a native chat's Claude child spends, read from the
// config folder it was launched in — a managed account's `claude-profiles/<id>/home`, or the base
// sign-in's folder (the system default, null).

const MANAGED_HOME = /[\\/]claude-profiles[\\/]([A-Za-z0-9_-]+)[\\/]home[\\/]?$/

function sameFolder(a: string, b: string): boolean {
  const normalize = (path: string): string => path.replace(/[\\/]+$/, '')
  return normalize(a) === normalize(b)
}

/** The account id, null for the base sign-in, undefined for a folder that names neither. */
export function claudeAccountIdOfHome(
  home: string,
  baseHome: string | null
): string | null | undefined {
  const managed = MANAGED_HOME.exec(home)
  if (managed) {
    return managed[1]
  }
  return baseHome !== null && sameFolder(home, baseHome) ? null : undefined
}

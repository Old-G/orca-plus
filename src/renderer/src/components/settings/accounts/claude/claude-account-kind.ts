// Custom build (claude-account-kind, owner 04.11: «I can't tell which account is which»): two sign-ins
// on one email differ only by organization. Claude names a personal plan's organization
// «<email>'s Organization», so that one reads «Personal» and any other its team's name.
export type ClaudeAccountKind = { title: string; kind: 'personal' | 'team' | null }

export function claudeAccountKind(account: {
  email: string
  organizationName?: string | null
}): ClaudeAccountKind {
  const org = account.organizationName?.trim()
  if (!org) {
    return { title: account.email, kind: null }
  }
  return /'s Organization$/i.test(org)
    ? { title: 'Personal', kind: 'personal' }
    : { title: org, kind: 'team' }
}

export type IntegrationCredentialService =
  | 'Linear'
  | 'Jira'
  | 'Bitbucket'
  | 'ClickUp'
  | 'Slack'
  // Custom build (hq-space-keys): a workspace's own token, of any kind.
  | 'Workspace'
  // Custom build (chat-auto-effort): the OpenRouter key Jev picks a chat's effort with.
  | 'OpenRouter'
  // Custom build (hq-mail-intake): the owner's Gmail OAuth client and refresh token.
  | 'Gmail'

export function credentialDecryptionMessage(service: IntegrationCredentialService): string {
  return `Could not decrypt saved ${service} credential. Approve Keychain access or reconnect ${service}.`
}

// IPC/RPC may preserve only error messages; detect the canonical decrypt-failure text.
export function isIntegrationCredentialDecryptionError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return (
    message.includes(credentialDecryptionMessage('Linear')) ||
    message.includes(credentialDecryptionMessage('Jira')) ||
    message.includes(credentialDecryptionMessage('Bitbucket')) ||
    message.includes(credentialDecryptionMessage('ClickUp')) ||
    message.includes(credentialDecryptionMessage('Slack'))
  )
}

export const LINEAR_AUTHENTICATION_ERROR = 'Linear authentication expired for this workspace.'

export function linearIssueReadFailureMessage(error: unknown): string {
  return isIntegrationCredentialDecryptionError(error)
    ? credentialDecryptionMessage('Linear')
    : 'Unable to load Linear issues. Try again.'
}

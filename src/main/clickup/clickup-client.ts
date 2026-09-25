import type {
  ClickUpConnectResult,
  ClickUpConnectionStatus,
  ClickUpViewer,
  ClickUpWorkspace
} from '../../shared/clickup-types'
import {
  clearStoredClickUpCredential,
  getClickUpCredentialError,
  getStoredClickUpMetadata,
  hasStoredClickUpCredential,
  loadStoredClickUpToken,
  saveClickUpCredential,
  setClickUpCredentialError,
  writeClickUpMetadata
} from './clickup-credential-store'
import { mapClickUpViewer, mapClickUpWorkspaces } from './clickup-task-mapping'
import { ClickUpApiError, clickUpRequest, isClickUpAuthError } from './clickup-request'

export type ClickUpSession = {
  token: string
  viewer: ClickUpViewer
  workspaceId: string
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}

export function getClickUpStatus(): ClickUpConnectionStatus {
  const metadata = hasStoredClickUpCredential() ? getStoredClickUpMetadata() : null
  const credentialError = getClickUpCredentialError()
  return {
    connected: metadata !== null,
    viewer: metadata?.viewer ?? null,
    workspaces: metadata?.workspaces ?? [],
    selectedWorkspaceId: metadata?.selectedWorkspaceId ?? null,
    ...(credentialError ? { credentialError } : {})
  }
}

async function readAccount(
  token: string
): Promise<{ viewer: ClickUpViewer; workspaces: ClickUpWorkspace[] }> {
  const viewer = mapClickUpViewer(await clickUpRequest(token, '/user'))
  if (!viewer) {
    throw new ClickUpApiError('ClickUp did not return the token owner.')
  }
  const workspaces = mapClickUpWorkspaces(await clickUpRequest(token, '/team'))
  if (workspaces.length === 0) {
    throw new ClickUpApiError('This ClickUp token has no workspace access.')
  }
  return { viewer, workspaces }
}

export async function connectClickUp(apiToken: string): Promise<ClickUpConnectResult> {
  const token = apiToken.trim()
  if (!token) {
    return { ok: false, error: 'Personal API token is required.' }
  }
  try {
    const { viewer, workspaces } = await readAccount(token)
    const previous = getStoredClickUpMetadata()?.selectedWorkspaceId
    saveClickUpCredential({
      token,
      viewer,
      workspaces,
      selectedWorkspaceId: workspaces.some((workspace) => workspace.id === previous)
        ? (previous ?? null)
        : workspaces[0].id
    })
    return { ok: true, viewer }
  } catch (error) {
    return { ok: false, error: errorMessage(error, 'Could not connect to ClickUp.') }
  }
}

export function disconnectClickUp(): void {
  clearStoredClickUpCredential()
}

export function selectClickUpWorkspace(workspaceId: string): ClickUpConnectionStatus {
  const metadata = getStoredClickUpMetadata()
  if (metadata && metadata.workspaces.some((workspace) => workspace.id === workspaceId)) {
    writeClickUpMetadata({ ...metadata, selectedWorkspaceId: workspaceId })
  }
  return getClickUpStatus()
}

export async function testClickUpConnection(): Promise<ClickUpConnectResult> {
  try {
    return await withClickUpSession(async (session) => {
      const { viewer, workspaces } = await readAccount(session.token)
      const metadata = getStoredClickUpMetadata()
      if (metadata) {
        // Why: refresh the workspace list so a newly joined workspace shows up.
        writeClickUpMetadata({
          ...metadata,
          viewer,
          workspaces,
          selectedWorkspaceId: workspaces.some(
            (workspace) => workspace.id === metadata.selectedWorkspaceId
          )
            ? metadata.selectedWorkspaceId
            : workspaces[0].id
        })
      }
      return { ok: true, viewer }
    })
  } catch (error) {
    return { ok: false, error: errorMessage(error, 'Could not reach ClickUp.') }
  }
}

/** Runs one authenticated operation and records a rejected token for the status card. */
export async function withClickUpSession<T>(
  run: (session: ClickUpSession) => Promise<T>
): Promise<T> {
  const metadata = getStoredClickUpMetadata()
  const token = loadStoredClickUpToken()
  if (!metadata || !token) {
    throw new ClickUpApiError('Not connected to ClickUp.')
  }
  const workspaceId = metadata.selectedWorkspaceId ?? metadata.workspaces[0]?.id
  if (!workspaceId) {
    throw new ClickUpApiError('No ClickUp workspace is selected.')
  }
  try {
    const result = await run({ token, viewer: metadata.viewer, workspaceId })
    setClickUpCredentialError(null)
    return result
  } catch (error) {
    if (isClickUpAuthError(error)) {
      setClickUpCredentialError(errorMessage(error, 'ClickUp rejected the API token.'))
    }
    throw error
  }
}

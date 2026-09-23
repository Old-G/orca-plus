import type {
  ClaudeIdeMentionRequest,
  ClaudeIdeMentionResult,
  ClaudeIdeRendererRequest,
  ClaudeIdeRendererResponse,
  ClaudeIdeSelection
} from '../../shared/claude-ide-bridge-types'

export type ClaudeIdeApi = {
  onRequest: (callback: (request: ClaudeIdeRendererRequest) => void) => () => void
  respond: (response: ClaudeIdeRendererResponse) => Promise<void>
  reportSelection: (selection: ClaudeIdeSelection | null) => void
  reportDiagnosticsChanged: (uris: string[]) => void
  mention: (request: ClaudeIdeMentionRequest) => Promise<ClaudeIdeMentionResult>
}

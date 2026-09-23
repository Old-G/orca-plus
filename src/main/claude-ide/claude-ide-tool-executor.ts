import { z } from 'zod'
import type {
  ClaudeIdeRendererMethod,
  ClaudeIdeSelection
} from '../../shared/claude-ide-bridge-types'
import { findClaudeIdeTool, type ClaudeIdeToolContent } from './claude-ide-tool-catalog'

export type ClaudeIdeToolResult = {
  content: ClaudeIdeToolContent[]
  isError?: boolean
}

export type ClaudeIdeAskOptions = { waitForUser: boolean }

export type ClaudeIdeToolExecutorDeps = {
  askRenderer: (
    method: ClaudeIdeRendererMethod,
    params: Record<string, unknown>,
    options: ClaudeIdeAskOptions
  ) => Promise<string>
  latestSelection: () => ClaudeIdeSelection | null
}

function textResult(text: string, isError = false): ClaudeIdeToolResult {
  return isError
    ? { content: [{ type: 'text', text }], isError }
    : { content: [{ type: 'text', text }] }
}

export function createClaudeIdeToolExecutor(deps: ClaudeIdeToolExecutorDeps) {
  return async function callTool(name: string, rawArgs: unknown): Promise<ClaudeIdeToolResult> {
    const tool = findClaudeIdeTool(name)
    if (!tool) {
      return textResult(`Unknown tool: ${name}`, true)
    }
    const parsed = z.object(tool.argumentSchema).safeParse(rawArgs ?? {})
    if (!parsed.success) {
      return textResult(`Invalid arguments for ${name}: ${parsed.error.message}`, true)
    }
    if (!tool.rendererMethod) {
      const selection = deps.latestSelection()
      return textResult(
        JSON.stringify(selection ?? { success: false, message: 'No selection available' }, null, 2)
      )
    }
    try {
      const reply = await deps.askRenderer(tool.rendererMethod, parsed.data, {
        waitForUser: tool.waitsForUser === true
      })
      return tool.formatResult
        ? { content: tool.formatResult(reply, parsed.data) }
        : textResult(reply)
    } catch (error) {
      return textResult(error instanceof Error ? error.message : String(error), true)
    }
  }
}

export type ClaudeIdeCallTool = ReturnType<typeof createClaudeIdeToolExecutor>

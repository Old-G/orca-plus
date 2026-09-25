// Custom build (slack-notifications): the Slack messages an agent update turns into.
import type { NotificationDispatchRequest } from '../../shared/notification-settings-types'
import {
  escapeSlackText,
  markdownToSlackMrkdwn,
  previewText,
  splitSlackMrkdwn
} from './slack-mrkdwn'

export type SlackAgentUpdateKind = 'needs-input' | 'finished' | 'stopped'

export type SlackGitSummary = {
  branch: string | null
  files: number
  added: number
  removed: number
  /** Commits not on the upstream yet; null when the branch tracks none. */
  ahead: number | null
}

export type SlackLinkedItem = { label: string; url: string }

export type SlackMessage = { text: string; blocks: Record<string, unknown>[] }

const PROMPT_PREVIEW_LENGTH = 300
const TOOL_PREVIEW_LENGTH = 200
// Why: a message holds at most 50 blocks; a few sections already carry the 8000-char agent message.
const MAX_MESSAGE_SECTIONS = 6

/** Null for a state Slack must not announce: a still-working agent never reads as finished (#4375). */
export function slackUpdateKind(request: NotificationDispatchRequest): SlackAgentUpdateKind | null {
  if (request.agentState === 'blocked' || request.agentState === 'waiting') {
    return 'needs-input'
  }
  if (request.agentState === 'working') {
    return null
  }
  return request.agentInterrupted ? 'stopped' : 'finished'
}

const KIND_HEADLINE: Record<SlackAgentUpdateKind, { emoji: string; verb: string }> = {
  'needs-input': { emoji: ':raising_hand:', verb: 'needs your input' },
  finished: { emoji: ':white_check_mark:', verb: 'finished' },
  stopped: { emoji: ':black_square_for_stop:', verb: 'stopped' }
}

function section(text: string): Record<string, unknown> {
  return { type: 'section', text: { type: 'mrkdwn', text } }
}

function context(text: string): Record<string, unknown> {
  return { type: 'context', elements: [{ type: 'mrkdwn', text }] }
}

export function formatSlackGitSummary(git: SlackGitSummary): string {
  const parts: string[] = []
  if (git.branch) {
    parts.push(`:seedling: \`${escapeSlackText(git.branch)}\``)
  }
  parts.push(
    git.files === 0
      ? 'no uncommitted changes'
      : `${git.files} ${git.files === 1 ? 'file' : 'files'} changed +${git.added} −${git.removed}`
  )
  if (git.ahead !== null && git.ahead > 0) {
    parts.push(`${git.ahead} ${git.ahead === 1 ? 'commit' : 'commits'} not pushed`)
  }
  return parts.join(' · ')
}

export function workspaceTitle(request: NotificationDispatchRequest): string {
  const repo = request.repoLabel?.trim()
  const worktree = request.worktreeLabel?.trim()
  return repo && worktree && repo !== worktree
    ? `${repo} / ${worktree}`
    : worktree || repo || 'workspace'
}

export function buildSlackThreadParent(input: {
  title: string
  linked: SlackLinkedItem | null
}): SlackMessage {
  const title = `*${escapeSlackText(input.title)}*`
  const linked = input.linked
    ? `\n:link: <${input.linked.url}|${escapeSlackText(input.linked.label)}>`
    : ''
  return {
    text: input.title,
    blocks: [
      section(`${title}${linked}`),
      context('Orca+ posts this workspace’s agent updates in this thread.')
    ]
  }
}

export function buildSlackAgentUpdate(input: {
  kind: SlackAgentUpdateKind
  agentLabel: string
  title: string
  request: NotificationDispatchRequest
  git: SlackGitSummary | null
}): SlackMessage {
  const { emoji, verb } = KIND_HEADLINE[input.kind]
  const headline = `${input.agentLabel} ${verb}`
  const blocks: Record<string, unknown>[] = [section(`${emoji} *${escapeSlackText(headline)}*`)]
  const prompt = previewText(input.request.agentPrompt, PROMPT_PREVIEW_LENGTH)
  if (prompt) {
    blocks.push(context(`:speech_balloon: ${escapeSlackText(prompt)}`))
  }
  const message = input.request.agentLastAssistantMessage?.trim()
  if (message) {
    const chunks = splitSlackMrkdwn(markdownToSlackMrkdwn(message))
    const kept = chunks.slice(0, MAX_MESSAGE_SECTIONS)
    const cut = chunks.length > kept.length ? kept.pop() : undefined
    blocks.push(...kept.map(section))
    if (cut !== undefined) {
      blocks.push(section(`${cut}\n…`))
    }
  }
  const tool = previewText(input.request.agentToolName, 60)
  if (input.kind === 'needs-input' && tool) {
    const toolInput = previewText(input.request.agentToolInput, TOOL_PREVIEW_LENGTH)
    blocks.push(
      section(
        `Waiting on \`${escapeSlackText(tool)}\`${toolInput ? `: \`${escapeSlackText(toolInput)}\`` : ''}`
      )
    )
  }
  if (input.git) {
    blocks.push(context(formatSlackGitSummary(input.git)))
  }
  return { text: `${headline} · ${input.title}`, blocks }
}

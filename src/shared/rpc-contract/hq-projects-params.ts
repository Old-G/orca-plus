// Custom build (hq): params of the hqProjects.* RPC — what HQ's tabs read from the Mac, so the
// paired web client can open HQ too. Every method only reads.
import { z } from 'zod'
import { OptionalBoolean, requiredString } from './rpc-param-primitives'

export const HqWikiPageParams = z.object({ path: requiredString('Wiki page path is required') })

export const HqProjectDiagramParams = z.object({ repoId: requiredString('Repo id is required') })

export const HqReviewsParams = z.object({ refresh: OptionalBoolean }).optional()

export const HqGitStateParams = z.object({ paths: z.array(z.string()).max(500) })

const HqClickUpListBindingParam = z.object({
  listId: z.string(),
  listName: z.string(),
  spaceId: z.string()
})

export const HqDraftTaskQuestionsParams = z.object({
  identifier: z.string().max(200),
  title: z.string().max(2_000),
  description: z.string().max(50_000)
})

/** Custom build (hq-voice-prompts): a dictation to rewrite, and an idea or a ClickUp task to file. */
export const HqVoiceRewriteParams = z.object({
  mode: z.enum(['agent', 'person', 'clickup', 'idea']),
  text: z.string().min(1).max(20_000)
})
export const HqVoiceIdeaParams = z.object({ text: z.string().min(1).max(20_000) })
/** Custom build (hq-read-aloud): one piece of an answer to speak. */
export const HqReadAloudSpeechParams = z.object({
  text: z.string().min(1).max(4000),
  voice: z.string().min(1).max(40)
})

/** Custom build (hq-slack-scout): one Slack-scout draft by its `<channel>:<ts>` id. */
export const HqSlackDraftRefParams = z.object({ id: z.string().min(1).max(200) })

/** The draft as the owner edited it, created as a ClickUp task. */
export const HqSlackDraftCreateParams = z.object({
  id: z.string().min(1).max(200),
  title: z.string().trim().min(1).max(300),
  description: z.string().max(20_000)
})

/** Custom build (hq-slack-requests): the owner's correction to a request; absent fields stay. */
export const HqSlackDraftEditParams = z.object({
  id: z.string().min(1).max(200),
  kind: z.enum(['do', 'answer', 'fyi']).optional(),
  project: z.string().max(200).nullable().optional(),
  ask: z.string().trim().max(500).optional(),
  title: z.string().trim().min(1).max(300).optional(),
  description: z.string().max(20_000).optional()
})

/** Custom build (hq-clickup-requests): the owner's reply to a ClickUp comment, and the draft it came from. */
/** Custom build (hq-mobile): what the phone may ask the Mac's window to run on a request. */
export const HQ_REQUEST_DESKTOP_ACTIONS = ['do', 'answer'] as const
export type HqRequestDesktopAction = (typeof HQ_REQUEST_DESKTOP_ACTIONS)[number]

export const HqRequestOnDesktopParams = z.object({
  id: z.string().min(1).max(200),
  action: z.enum(HQ_REQUEST_DESKTOP_ACTIONS)
})

export const HqBellActionOnDesktopParams = z.object({
  itemId: z.string().min(1).max(200),
  actionId: z.string().min(1).max(100)
})

export const HqClickUpReplyParams = z.object({
  id: z.string().min(1).max(200),
  text: z.string().trim().min(1).max(20_000),
  draft: z.string().max(20_000).optional()
})

/** Only what HQ itself edits; the HQ folder and the quiet threshold stay Settings-only on the Mac. */
export const HqUpdateSettingsParams = z.object({
  hqProjectClickUpLists: z.record(z.string(), HqClickUpListBindingParam).optional(),
  hqDeferredDismissed: z.record(z.string(), z.number()).optional(),
  hqTriageDecisions: z
    .record(
      z.string(),
      z.object({
        decision: z.enum(['taken', 'hidden', 'asked', 'closed']),
        at: z.number(),
        repoId: z.string().optional(),
        worktreeId: z.string().optional(),
        paneKey: z.string().optional(),
        coordinator: z.boolean().optional(),
        acceptedAt: z.number().optional(),
        mergeAskedAt: z.number().optional(),
        commentAskedAt: z.number().optional(),
        lastToldAt: z.number().optional(),
        commentedAt: z.number().optional(),
        hours: z.number().optional()
      })
    )
    .optional()
})

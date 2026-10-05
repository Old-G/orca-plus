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

/** Only what HQ itself edits; the HQ folder and the quiet threshold stay Settings-only on the Mac. */
export const HqUpdateSettingsParams = z.object({
  hqProjectClickUpLists: z.record(z.string(), HqClickUpListBindingParam).optional(),
  hqDeferredDismissed: z.record(z.string(), z.number()).optional(),
  hqTriageDecisions: z
    .record(
      z.string(),
      z.object({
        decision: z.enum(['taken', 'hidden', 'asked']),
        at: z.number(),
        repoId: z.string().optional()
      })
    )
    .optional()
})

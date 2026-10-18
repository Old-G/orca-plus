// Custom build (hq-mobile-messenger): HQ's chat list as the desktop window last built it, slimmed
// for the phone — the same sections (needs you, working, done, active projects, quiet) and enough to
// open each chat in the phone's session screen.
import { z } from 'zod'

export const HQ_CHAT_WIRE_GROUPS = ['needs', 'working', 'done', 'active', 'quiet'] as const
export type HqChatWireGroup = (typeof HQ_CHAT_WIRE_GROUPS)[number]

export const HqChatWireItemSchema = z.object({
  key: z.string().max(400),
  group: z.enum(HQ_CHAT_WIRE_GROUPS),
  worktreeId: z.string().max(400),
  /** Opens the chat on the phone; null when the desktop has no pane for it yet. */
  paneKey: z.string().max(400).nullable(),
  /** The workspace's host; a `runtime:` one is named in the phone's session route. */
  executionHostId: z.string().max(200).nullable(),
  projectName: z.string().max(200),
  worktreeName: z.string().max(200),
  title: z.string().max(300),
  preview: z.string().max(400),
  agentType: z.string().max(60),
  unseen: z.boolean(),
  sortAt: z.number(),
  color: z.string().max(40).nullable(),
  /** Custom build (hq-spaces): places the chat in its workspace; absent from older Macs. */
  repoId: z.string().max(200).optional()
})
export type HqChatWireItem = z.infer<typeof HqChatWireItemSchema>

export const HqChatWireListSchema = z.object({
  items: z.array(HqChatWireItemSchema).max(500),
  /** Epoch ms of the desktop's last publish; 0 when no window has published yet. */
  publishedAt: z.number()
})
export type HqChatWireList = z.infer<typeof HqChatWireListSchema>

export function readHqChatWireList(value: unknown): HqChatWireList | null {
  const parsed = HqChatWireListSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}

export function groupHqChatWire(
  items: readonly HqChatWireItem[]
): Record<HqChatWireGroup, HqChatWireItem[]> {
  const groups: Record<HqChatWireGroup, HqChatWireItem[]> = {
    needs: [],
    working: [],
    done: [],
    active: [],
    quiet: []
  }
  for (const item of items) {
    groups[item.group].push(item)
  }
  return groups
}

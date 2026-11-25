// Custom build (hq-mobile-messenger): HQ's chat list as the desktop window last built it, slimmed
// for the phone — the same sections (needs you, working, done, active projects, quiet) and enough to
// open each chat in the phone's session screen.
import * as z from 'zod'

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
  repoId: z.string().max(200).optional(),
  /** Custom build (hq-plus-phone): the native chat's session, as HQ+'s feed names it; absent from older Macs. */
  sessionId: z.string().max(200).nullable().optional(),
  /** Custom build (hq-stable-chat-order): when the chat took its place; absent from older Macs. */
  placedAt: z.number().optional()
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

/**
 * Custom build (hq-stable-chat-order, owner 25.11): the open chats by project in an order that what the
 * chats do never changes — newest chat first in its project, the project of the newest chat first. A
 * Mac that sends no `placedAt` keeps its own order.
 */
export function hqChatWireByProject(
  items: readonly HqChatWireItem[]
): { project: string; items: HqChatWireItem[] }[] {
  const byProject = new Map<string, HqChatWireItem[]>()
  // Why the key: agents in split panes of one terminal share its `placedAt`; the order they arrive in
  // follows their state.
  const placed = (a: HqChatWireItem, b: HqChatWireItem): number =>
    (b.placedAt ?? 0) - (a.placedAt ?? 0) ||
    (a.placedAt === undefined || b.placedAt === undefined
      ? 0
      : a.key < b.key
        ? -1
        : a.key > b.key
          ? 1
          : 0)
  for (const item of items.toSorted(placed)) {
    byProject.set(item.projectName, [...(byProject.get(item.projectName) ?? []), item])
  }
  return [...byProject].map(([project, chats]) => ({ project, items: chats }))
}

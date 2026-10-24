// Custom build (hq-plus-context): a new room — `HQ/workspaces/<slug>/workspace.yaml`, read by the
// same hq-spaces module as every room, and a context.md for the owner to fill in.
import { mkdir, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { stringify } from 'yaml'
import {
  HQ_CONTEXT_KIND,
  HQ_ROOM_CONTEXT_FILE,
  HQ_ROOM_CONTEXT_TEMPLATE,
  type HqRoomAddResult
} from '../../shared/hq-context'
import { HQ_JOURNAL_ALL_ROOMS, hqSlug, type HqJournalInput } from '../../shared/hq-journal'
import { HQ_SPACE_FILE, HQ_SPACE_SLUG, HQ_SPACES_DIR } from '../../shared/hq-spaces'

export type HqRoomAddInput = {
  name: string
  slug?: string
  color?: string
  messenger?: string
  tasks?: string
  /** Custom build (hq-rooms): the Orca sidebar group this room is. */
  groupId?: string
}

async function exists(path: string): Promise<boolean> {
  return stat(path).then(
    () => true,
    () => false
  )
}

export async function addHqRoom(hqPath: string, input: HqRoomAddInput): Promise<HqRoomAddResult> {
  const name = input.name.trim()
  const slug = input.slug?.trim() || hqSlug(name)
  if (!name || !HQ_SPACE_SLUG.test(slug)) {
    throw new Error('A room needs a name and a slug of latin letters, digits and dashes.')
  }
  if (input.color && !/^#[0-9a-fA-F]{6}$/.test(input.color)) {
    throw new Error('--color takes #rrggbb.')
  }
  const dir = join(hqPath, HQ_SPACES_DIR, slug)
  if (await exists(join(dir, HQ_SPACE_FILE))) {
    throw new Error(`Room ${slug} already exists.`)
  }
  await mkdir(dir, { recursive: true })
  const file = stringify({
    name,
    color: input.color ?? '#737373',
    order: 100,
    ...(input.groupId ? { group_id: input.groupId } : {}),
    groups: [],
    projects: [],
    messenger: input.messenger ?? null,
    tasks: input.tasks ?? null
  })
  // Custom build (hq-plus-room-mcp): where a room names the MCP servers its chats start without.
  const mcpHint =
    "# mcp:\n#   deny: []  # MCP servers this room's chats start without, e.g. claude.ai Acme*\n"
  await writeFile(join(dir, HQ_SPACE_FILE), file + mcpHint)
  const created = [`${HQ_SPACES_DIR}/${slug}/${HQ_SPACE_FILE}`]
  if (!(await exists(join(dir, HQ_ROOM_CONTEXT_FILE)))) {
    await writeFile(
      join(dir, HQ_ROOM_CONTEXT_FILE),
      HQ_ROOM_CONTEXT_TEMPLATE.replace('{{name}}', name)
        .replace('{{tasks}}', input.tasks ?? 'не указаны')
        .replace('{{messenger}}', input.messenger ?? 'не указаны')
    )
    created.push(`${HQ_SPACES_DIR}/${slug}/${HQ_ROOM_CONTEXT_FILE}`)
  }
  return { slug, path: dir, created }
}

export function hqRoomAddedEntry(added: HqRoomAddResult, name: string): HqJournalInput {
  return {
    workspace: HQ_JOURNAL_ALL_ROOMS,
    kind: HQ_CONTEXT_KIND.roomAdded,
    project: null,
    address: null,
    sessionId: null,
    personId: null,
    title: `Новая комната: ${name} (${added.slug})`,
    needs: 'nobody',
    status: 'done',
    replyTo: null,
    refKind: 'file',
    refId: added.created[0] ?? null,
    source: 'hq-plus',
    dedupeKey: `${HQ_CONTEXT_KIND.roomAdded}:${added.slug}`
  }
}

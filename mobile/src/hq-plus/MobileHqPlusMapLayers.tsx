// Custom build (hq-plus-phone-map): what lies over the phone's Map — the picked project's screen from
// the right and the room's open chats in a sheet from the bottom.
import type { HqpFeedContext } from './mobile-hq-plus-feed-context'
import { MobileHqPlusMapChats } from './MobileHqPlusMapChats'
import { MobileHqPlusProject } from './MobileHqPlusProject'
import type { HqPlusPhoneMap } from './use-hq-plus-phone-map'

export function MobileHqPlusMapLayers({
  map,
  now,
  ctx,
  bottom,
  onNotice,
  onSort
}: {
  map: HqPlusPhoneMap
  now: number
  ctx: HqpFeedContext
  /** The home indicator's inset. */
  bottom: number
  onNotice: (text: string) => void
  onSort: () => void
}) {
  const project = map.project
  return (
    <>
      <MobileHqPlusProject
        room={map.rooms.find((entry) => entry.slug === project?.room) ?? null}
        slug={project?.slug ?? null}
        now={now}
        ctx={ctx}
        onBack={() => map.setProject(null)}
        onCloseChat={map.closeChat}
        // Why: the phone has no path to start a chat in a project; the Mac's map does it.
        onNewChat={() => onNotice('Start a chat on the Mac: the project → + New chat.')}
        onWorkspace={project ? map.workspaceOf(project.slug) : null}
        onSort={() => {
          map.setProject(null)
          onSort()
        }}
      />
      <MobileHqPlusMapChats
        open={map.sheet}
        chats={map.chats}
        bottom={bottom}
        onOpen={(chat) => {
          map.setSheet(false)
          ctx.openChat(chat)
        }}
        onCloseChat={map.closeChat}
        onClose={() => map.setSheet(false)}
      />
    </>
  )
}

// Custom build (hq-plus-phone-map): what lies over the phone's Map — the picked project's screen from
// the right and the room's open chats in a sheet from the bottom.
import type { HqpFeedContext } from './mobile-hq-plus-feed-context'
import type { HqPlusProjectCard } from '../../../src/shared/hq-plus-project-cards'
import type { HqpProjectContext } from './MobileHqPlusProjectParts'
import { MobileHqPlusMapChats } from './MobileHqPlusMapChats'
import { MobileHqPlusProject } from './MobileHqPlusProject'
import type { HqPlusPhoneMap } from './use-hq-plus-phone-map'

export function MobileHqPlusMapLayers({
  map,
  ctx,
  bottom,
  projectCard,
  projectCtx
}: {
  map: HqPlusPhoneMap
  ctx: HqpFeedContext
  /** Custom build (hq-project-cards): a picked project's card, the feed's own. */
  projectCard: (slug: string) => HqPlusProjectCard
  projectCtx: HqpProjectContext
  /** The home indicator's inset. */
  bottom: number
}) {
  const project = map.project
  return (
    <>
      <MobileHqPlusProject
        room={map.rooms.find((entry) => entry.slug === project?.room) ?? null}
        slug={project?.slug ?? null}
        card={project ? projectCard(project.slug) : null}
        ctx={projectCtx}
        onBack={() => map.setProject(null)}
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

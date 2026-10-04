// Custom build (hq): Orca+'s HQ — one screen for agents, waitings, projects, the wiki, the day and
// the map; another surface can open it on a given tab. Narrow widths (a phone) lay out by the
// screen's own width, not the window's.
import { useEffect, useState } from 'react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { translate } from '@/i18n/i18n'
import { isWebClientLocation } from '@/lib/web-client-location'
import WebPushPrompt from '@/web/WebPushPrompt'
import { HqAgentsTab } from './HqAgentsTab'
import { HqMapTab } from './HqMapTab'
import { HqProjectsTab } from './HqProjectsTab'
import { HqTodayTab } from './HqTodayTab'
import { HqWaitingTab } from './HqWaitingTab'
import { HqWikiTab } from './HqWikiTab'
import { onHqTabRequested, takeRequestedHqTab } from './hq-view'
import { useHqWebSettings } from './use-hq-web-settings'

const HQ_TABS = [
  { id: 'agents', label: () => translate('auto.hq.tab.agents', 'Agents') },
  { id: 'waiting', label: () => translate('auto.hq.tab.waiting', 'Waiting') },
  { id: 'projects', label: () => translate('auto.hq.tab.projects', 'Projects') },
  { id: 'wiki', label: () => translate('auto.hq.tab.wiki', 'Wiki') },
  { id: 'today', label: () => translate('auto.hq.tab.today', 'Today') },
  { id: 'map', label: () => translate('auto.hq.tab.map', 'Map') }
] as const

type HqTabId = (typeof HQ_TABS)[number]['id']

function findTab(id: string | null): HqTabId | null {
  return HQ_TABS.find((entry) => entry.id === id)?.id ?? null
}

export default function HqScreen(): React.JSX.Element {
  const [tab, setTab] = useState<HqTabId>(() => findTab(takeRequestedHqTab()) ?? 'agents')
  useHqWebSettings()
  useEffect(
    () =>
      onHqTabRequested((requested) => {
        const found = findTab(requested)
        if (found) {
          takeRequestedHqTab()
          setTab(found)
        }
      }),
    []
  )
  return (
    <Tabs
      value={tab}
      onValueChange={(next) => {
        const found = findTab(next)
        if (found) {
          setTab(found)
        }
      }}
      className="@container/hq flex h-full min-h-0 w-full flex-col"
    >
      <div className="flex shrink-0 items-center gap-4 border-b border-border px-4 py-2">
        {/* Why: at phone width the six tabs need the whole row, in a 3×2 grid. */}
        <h1 className="text-sm font-semibold @max-md/hq:sr-only">
          {translate('auto.hq.title', 'HQ')}
        </h1>
        <TabsList
          variant="line"
          className="@max-md/hq:grid @max-md/hq:min-h-max @max-md/hq:w-full @max-md/hq:grid-cols-3"
        >
          {HQ_TABS.map((entry) => (
            <TabsTrigger key={entry.id} value={entry.id}>
              {entry.label()}
            </TabsTrigger>
          ))}
        </TabsList>
      </div>
      {isWebClientLocation() ? <WebPushPrompt /> : null}
      {/* Why: Radix unmounts inactive content, so the live board derivation runs only while shown. */}
      <TabsContent value="agents" className="min-h-0 flex-1">
        <HqAgentsTab />
      </TabsContent>
      <TabsContent value="waiting" className="min-h-0 flex-1">
        <HqWaitingTab />
      </TabsContent>
      <TabsContent value="projects" className="min-h-0 flex-1">
        <HqProjectsTab />
      </TabsContent>
      <TabsContent value="wiki" className="min-h-0 flex-1">
        <HqWikiTab />
      </TabsContent>
      <TabsContent value="today" className="min-h-0 flex-1">
        <HqTodayTab />
      </TabsContent>
      <TabsContent value="map" className="min-h-0 flex-1">
        <HqMapTab />
      </TabsContent>
    </Tabs>
  )
}

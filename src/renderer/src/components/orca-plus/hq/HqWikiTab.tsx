// Custom build (hq): the HQ «Wiki» tab — the HQ folder's pages as a tree, one page read at a time;
// at phone width the tree and the page take turns on the whole width.
import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, List } from 'lucide-react'
import type { HqWikiEntry } from '../../../../../shared/hq-project-pages'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import CommentMarkdown from '@/components/sidebar/CommentMarkdown'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import {
  HQ_WIKI_HOME,
  HQ_WIKI_ROOT_SECTION,
  buildHqWikiSections,
  hqWikiBody,
  resolveHqWikiLink
} from './hq-wiki-tree'
import { useHqWikiPage } from './use-hq-wiki-page'

type TreeState =
  | { status: 'loading' }
  | { status: 'ready'; entries: HqWikiEntry[] }
  | { status: 'error'; message: string }
function sectionTitle(id: string): string {
  return id === HQ_WIKI_ROOT_SECTION ? translate('auto.hq.wiki.rootSection', 'HQ') : id
}

function useHqWikiTree(hqPath: string | null): TreeState {
  const [loaded, setLoaded] = useState<{ hqPath: string; state: TreeState } | null>(null)
  useEffect(() => {
    if (!hqPath) {
      return
    }
    let alive = true
    window.api.hqProjects
      .wikiTree()
      .then((result) => {
        if (alive) {
          setLoaded({
            hqPath,
            state: result.ok
              ? { status: 'ready', entries: result.entries }
              : { status: 'error', message: result.error }
          })
        }
      })
      .catch((error: unknown) => {
        if (alive) {
          setLoaded({ hqPath, state: { status: 'error', message: String(error) } })
        }
      })
    return () => {
      alive = false
    }
  }, [hqPath])
  return loaded?.hqPath === hqPath ? loaded.state : { status: 'loading' }
}

export function HqWikiTab(): React.JSX.Element {
  const hqPath = useAppStore((s) => s.settings?.hqPath ?? null)
  const tree = useHqWikiTree(hqPath)
  const [filter, setFilter] = useState('')
  const [history, setHistory] = useState<string[]>([])
  // Why: only read at narrow widths, where the tree replaces the page instead of sitting beside it.
  const [pagesOpen, setPagesOpen] = useState(false)
  const entries = tree.status === 'ready' ? tree.entries : null
  const sections = useMemo(() => buildHqWikiSections(entries ?? [], filter), [entries, filter])
  const defaultPath =
    entries?.find((entry) => entry.path === HQ_WIKI_HOME)?.path ?? entries?.[0]?.path ?? null
  const current = history.at(-1) ?? defaultPath
  const page = useHqWikiPage(current)
  const open = (path: string): void => {
    setPagesOpen(false)
    if (path !== current) {
      // Why: the first page shown is the default, not in history yet; Back must return to it.
      setHistory((previous) => [...(previous.length > 0 || !current ? previous : [current]), path])
    }
  }

  if (!hqPath) {
    return (
      <p className="p-4 text-sm text-muted-foreground">
        {translate('auto.hq.wiki.off', 'Set an HQ folder in Settings to read its wiki here.')}
      </p>
    )
  }
  if (tree.status !== 'ready') {
    return (
      <p className="p-4 text-sm text-muted-foreground">
        {tree.status === 'loading'
          ? translate('auto.hq.wiki.loading', 'Loading…')
          : translate('auto.hq.wiki.treeFailed', "Couldn't read the HQ folder: {{value0}}", {
              value0: tree.message
            })}
      </p>
    )
  }
  return (
    <div className="flex h-full min-h-0">
      <nav
        data-open={pagesOpen}
        className="scrollbar-sleek flex w-64 shrink-0 flex-col gap-3 overflow-y-auto border-r border-border p-3 @max-xl/hq:w-full @max-xl/hq:border-r-0 @max-xl/hq:data-[open=false]:hidden"
        aria-label={translate('auto.hq.wiki.pages', 'HQ pages')}
      >
        <Input
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder={translate('auto.hq.wiki.filter', 'Filter pages…')}
          aria-label={translate('auto.hq.wiki.filter', 'Filter pages…')}
        />
        {sections.map((section) => (
          <section key={section.id} className="flex flex-col gap-0.5">
            <h2 className="px-2 text-[11px] font-semibold tracking-[0.05em] text-muted-foreground uppercase">
              {sectionTitle(section.id)}
            </h2>
            {section.entries.map((entry) => (
              <button
                key={entry.path}
                type="button"
                title={entry.path}
                aria-current={entry.path === current ? 'page' : undefined}
                onClick={() => open(entry.path)}
                className="truncate rounded-md px-2 py-1 text-left text-[13px] hover:bg-accent aria-[current=page]:bg-accent aria-[current=page]:font-medium"
              >
                {entry.title}
              </button>
            ))}
          </section>
        ))}
      </nav>
      <article
        data-open={pagesOpen}
        className="scrollbar-sleek min-w-0 flex-1 overflow-y-auto @max-xl/hq:data-[open=true]:hidden"
      >
        {page ? (
          <div className="mx-auto flex max-w-3xl flex-col gap-3 p-6 @max-md/hq:p-4">
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                className="@xl/hq:hidden"
                onClick={() => setPagesOpen(true)}
                aria-label={translate('auto.hq.wiki.pages', 'HQ pages')}
              >
                <List />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                disabled={history.length < 2}
                onClick={() => setHistory((previous) => previous.slice(0, -1))}
                aria-label={translate('auto.hq.wiki.back', 'Back')}
              >
                <ArrowLeft />
              </Button>
              <span className="truncate font-mono text-xs text-muted-foreground">{page.path}</span>
            </div>
            {page.status === 'ready' ? (
              <CommentMarkdown
                variant="document"
                content={hqWikiBody(page.markdown)}
                className="text-sm"
                onLinkClick={(event, href) => {
                  const target = resolveHqWikiLink(page.path, href)
                  if (target) {
                    event.preventDefault()
                    open(target)
                  }
                }}
              />
            ) : (
              <p className="text-sm text-muted-foreground">
                {page.status === 'loading'
                  ? translate('auto.hq.wiki.loading', 'Loading…')
                  : translate('auto.hq.wiki.pageFailed', "Couldn't read this page: {{value0}}", {
                      value0: page.message
                    })}
              </p>
            )}
          </div>
        ) : (
          <p className="p-6 text-sm text-muted-foreground">
            {translate('auto.hq.wiki.empty', 'This HQ folder has no pages yet.')}
          </p>
        )}
      </article>
    </div>
  )
}

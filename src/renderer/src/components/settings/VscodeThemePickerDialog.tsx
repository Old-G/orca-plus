import { useState } from 'react'
import type React from 'react'
import { ArrowLeft, FileUp, Loader2, Search, Trash2 } from 'lucide-react'
import type { GlobalSettings } from '../../../../shared/global-settings-types'
import {
  isDarkVscodeThemeBase,
  type VscodeThemeBase
} from '../../../../shared/vscode-theme/vscode-theme-types'
import { translate } from '@/i18n/i18n'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '../ui/dialog'
import { Input } from '../ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs'
import { useVscodeThemePicker, type PickerError } from './vscode-theme-picker-model'

type VscodeThemePickerDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  updateSettings: (updates: Partial<GlobalSettings>) => void
}

function describePickerError(error: PickerError): string {
  switch (error) {
    case 'network':
      return translate(
        'settings.appearance.customAppearance.theme.errorNetwork',
        'Could not download from Open VSX.'
      )
    case 'search-failed':
      return translate(
        'settings.appearance.customAppearance.theme.errorSearch',
        'Open VSX search failed.'
      )
    case 'no-themes':
      return translate(
        'settings.appearance.customAppearance.theme.errorNoThemes',
        'This extension has no color themes.'
      )
    case 'not-found':
      return translate(
        'settings.appearance.customAppearance.theme.errorNotFound',
        'The extension is no longer installed.'
      )
    case 'invalid-extension':
      return translate(
        'settings.appearance.customAppearance.theme.errorInvalid',
        'This is not a valid VS Code extension.'
      )
    case 'import-failed':
      return translate(
        'settings.appearance.customAppearance.theme.errorImport',
        'Could not import this theme.'
      )
  }
}

function ModeBadge({ base }: { base: VscodeThemeBase }): React.JSX.Element {
  return (
    <Badge variant="outline">
      {isDarkVscodeThemeBase(base)
        ? translate('settings.appearance.customAppearance.theme.dark', 'Dark')
        : translate('settings.appearance.customAppearance.theme.light', 'Light')}
    </Badge>
  )
}

function Row({
  title,
  detail,
  onClick,
  disabled,
  trailing
}: {
  title: string
  detail?: React.ReactNode
  onClick: () => void
  disabled: boolean
  trailing?: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="flex items-center gap-2 rounded-md px-2 hover:bg-accent/40">
      <button
        type="button"
        disabled={disabled}
        onClick={onClick}
        className="flex min-w-0 flex-1 items-center gap-2 py-2 text-left text-sm disabled:opacity-60"
      >
        <span className="min-w-0 flex-1 truncate">{title}</span>
        {detail}
      </button>
      {trailing}
    </div>
  )
}

function ListFrame({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <div className="scrollbar-sleek max-h-[320px] overflow-y-auto pr-1">{children}</div>
}

function Empty({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <p className="py-6 text-center text-xs text-muted-foreground">{children}</p>
}

/** Custom build (custom-appearance-theme-ui): pick a VS Code / Cursor color theme. */
export function VscodeThemePickerDialog({
  open,
  onOpenChange,
  updateSettings
}: VscodeThemePickerDialogProps): React.JSX.Element {
  const picker = useVscodeThemePicker(open, updateSettings, () => onOpenChange(false))
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('')
  const opened = picker.opened
  const visibleThemes = opened?.themes.filter((theme) =>
    theme.label.toLowerCase().includes(filter.trim().toLowerCase())
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[640px]">
        <DialogHeader>
          <DialogTitle>
            {translate('settings.appearance.customAppearance.theme.pickerTitle', 'Choose a theme')}
          </DialogTitle>
          <DialogDescription>
            {translate(
              'settings.appearance.customAppearance.theme.pickerDescription',
              'VS Code and Cursor color themes recolor Orca, the editor and the terminal.'
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-[360px] space-y-3">
          {opened && visibleThemes ? (
            <>
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="xs" onClick={() => picker.closeSource()}>
                  <ArrowLeft className="size-3.5" />
                  {translate('settings.appearance.customAppearance.theme.back', 'Back')}
                </Button>
                <span className="min-w-0 flex-1 truncate text-sm font-medium">
                  {opened.displayName}
                </span>
                <span className="text-[11px] text-muted-foreground">{opened.version}</span>
              </div>
              {opened.themes.length > 8 ? (
                <Input
                  autoFocus
                  value={filter}
                  onChange={(event) => setFilter(event.target.value)}
                  placeholder={translate(
                    'settings.appearance.customAppearance.theme.filter',
                    'Filter themes'
                  )}
                />
              ) : null}
              <ListFrame>
                {visibleThemes.map((theme) => (
                  <Row
                    key={theme.label}
                    title={theme.label}
                    detail={<ModeBadge base={theme.base} />}
                    disabled={picker.busy}
                    onClick={() => void picker.pick(theme.label)}
                  />
                ))}
              </ListFrame>
            </>
          ) : (
            <Tabs defaultValue={picker.imported.length > 0 ? 'imported' : 'installed'}>
              <TabsList>
                <TabsTrigger value="imported">
                  {translate('settings.appearance.customAppearance.theme.tabImported', 'Imported')}
                </TabsTrigger>
                <TabsTrigger value="installed">
                  {translate(
                    'settings.appearance.customAppearance.theme.tabInstalled',
                    'Cursor & VS Code'
                  )}
                </TabsTrigger>
                <TabsTrigger value="open-vsx">
                  {translate('settings.appearance.customAppearance.theme.tabOpenVsx', 'Open VSX')}
                </TabsTrigger>
              </TabsList>

              <TabsContent value="imported">
                <ListFrame>
                  {picker.imported.length === 0 ? (
                    <Empty>
                      {translate(
                        'settings.appearance.customAppearance.theme.noImported',
                        'No imported themes yet.'
                      )}
                    </Empty>
                  ) : (
                    picker.imported.map((theme) => (
                      <Row
                        key={theme.id}
                        title={theme.label}
                        detail={<ModeBadge base={theme.base} />}
                        disabled={picker.busy}
                        onClick={() => void picker.choose(theme.id)}
                        trailing={
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            aria-label={translate(
                              'settings.appearance.customAppearance.theme.removeImported',
                              'Delete theme'
                            )}
                            disabled={picker.busy}
                            onClick={() => void picker.remove(theme.id)}
                          >
                            <Trash2 className="size-3.5" />
                          </Button>
                        }
                      />
                    ))
                  )}
                </ListFrame>
              </TabsContent>

              <TabsContent value="installed">
                <ListFrame>
                  {picker.installed === null ? (
                    <Empty>
                      <Loader2 className="mx-auto size-4 animate-spin" />
                    </Empty>
                  ) : picker.installed.length === 0 ? (
                    <Empty>
                      {translate(
                        'settings.appearance.customAppearance.theme.noInstalled',
                        'No themes found in Cursor or VS Code.'
                      )}
                    </Empty>
                  ) : (
                    picker.installed.map((extension) => (
                      <Row
                        key={`${extension.editor}:${extension.extensionId}`}
                        title={extension.displayName}
                        detail={
                          <span className="shrink-0 text-[11px] text-muted-foreground">
                            {extension.editor === 'cursor'
                              ? translate(
                                  'settings.appearance.customAppearance.theme.editorCursor',
                                  'Cursor'
                                )
                              : translate(
                                  'settings.appearance.customAppearance.theme.editorVscode',
                                  'VS Code'
                                )}{' '}
                            · {extension.themes.length}
                          </span>
                        }
                        disabled={picker.busy}
                        onClick={() =>
                          void picker.open({
                            kind: 'installed',
                            editor: extension.editor,
                            extensionId: extension.extensionId
                          })
                        }
                      />
                    ))
                  )}
                </ListFrame>
              </TabsContent>

              <TabsContent value="open-vsx">
                <div className="space-y-3">
                  <form
                    className="flex gap-2"
                    onSubmit={(event) => {
                      event.preventDefault()
                      if (query.trim()) {
                        void picker.search(query.trim())
                      }
                    }}
                  >
                    <Input
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      placeholder={translate(
                        'settings.appearance.customAppearance.theme.searchPlaceholder',
                        'Search Open VSX themes'
                      )}
                    />
                    <Button type="submit" variant="outline" size="sm" disabled={picker.busy}>
                      <Search className="size-3.5" />
                      {translate('settings.appearance.customAppearance.theme.search', 'Search')}
                    </Button>
                  </form>
                  <ListFrame>
                    {picker.searchResults?.length === 0 ? (
                      <Empty>
                        {translate(
                          'settings.appearance.customAppearance.theme.noResults',
                          'No themes match.'
                        )}
                      </Empty>
                    ) : (
                      picker.searchResults?.map((result) => (
                        <Row
                          key={`${result.namespace}.${result.name}`}
                          title={result.displayName}
                          detail={
                            <span className="shrink-0 text-[11px] text-muted-foreground">
                              {result.namespace}
                            </span>
                          }
                          disabled={picker.busy}
                          onClick={() =>
                            void picker.open({
                              kind: 'open-vsx',
                              namespace: result.namespace,
                              name: result.name
                            })
                          }
                        />
                      ))
                    )}
                  </ListFrame>
                </div>
              </TabsContent>
            </Tabs>
          )}
          {picker.error ? (
            <p className="text-xs text-destructive">{describePickerError(picker.error)}</p>
          ) : null}
        </div>

        <DialogFooter>
          {picker.busy ? <Loader2 className="size-4 animate-spin text-muted-foreground" /> : null}
          <Button
            variant="outline"
            size="sm"
            disabled={picker.busy}
            onClick={() => void picker.open({ kind: 'vsix-file' })}
          >
            <FileUp className="size-3.5" />
            {translate('settings.appearance.customAppearance.theme.fromFile', 'From .vsix file…')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

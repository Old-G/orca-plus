// Custom build (hq-plus-ui-v5): «To work» on a Slack, ClickUp or mail request opens here on the right —
// the suggested project preselected, any project and any of its chats (or a new one) to choose, the
// request's text to adjust and a note. A new chat for a scout request goes the classic «Do» way
// (ClickUp task, then Claude in the project); an existing chat gets the request as its next turn.
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import {
  HQ_INTAKE_KIND,
  hqIntakePrompt,
  hqRequestTakePrompt,
  readHqIntake
} from '../../../../../shared/hq-slack-intake'
import { readHqSlackRequestRef } from '../../../../../shared/hq-slack-request-bell'
import type { HqSlackScoutDraft } from '../../../../../shared/hq-slack-scout'
import type { PulseInboxItem } from '../../../../../shared/pulse-types'
import { Textarea } from '@/components/ui/textarea'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import { HqRouteForm } from '../pulse-bell/HqRouteForm'
import { hqRouteTargetFor } from '../pulse-bell/hq-intake-toasts'
import { sendHqRoutePrompt } from '../pulse-bell/hq-route-send'
import { HQ_ROUTE_NEW_CHAT } from '../pulse-bell/hq-route-targets'
import { doHqSlackRequest } from '../slack-requests/hq-slack-request-actions'

type Request = {
  title: string
  author: string
  text: string
  repoId: string | null
  draft: HqSlackScoutDraft | null
}

async function loadRequest(item: PulseInboxItem): Promise<Request | null> {
  if (item.kind === HQ_INTAKE_KIND) {
    const intake = readHqIntake(item.refId)
    return intake
      ? {
          title: item.title,
          author: intake.author,
          text: intake.text,
          repoId: intake.repoId,
          draft: null
        }
      : null
  }
  const ref = readHqSlackRequestRef(item.refId)
  if (!ref) {
    return null
  }
  const [drafts, pages] = await Promise.all([
    window.api.hqProjects.slackDrafts(),
    window.api.hqProjects.list()
  ])
  const draft = drafts.ok ? (drafts.drafts.find((entry) => entry.id === ref.id) ?? null) : null
  if (!draft) {
    return null
  }
  const page = pages.ok ? pages.pages.find((entry) => entry.slug === draft.project) : undefined
  return {
    title: item.title,
    author: draft.author,
    text: draft.description || draft.quote || draft.title,
    repoId: page?.repoId ?? null,
    draft
  }
}

function repoName(repoId: string | null): string | null {
  return useAppStore.getState().repos.find((repo) => repo.id === repoId)?.displayName ?? null
}

/** The HQ page slug of a project, so a new chat for a scout request can go the classic way. */
async function slugOfRepo(repoId: string): Promise<string | null> {
  const pages = await window.api.hqProjects.list()
  return pages.ok ? (pages.pages.find((page) => page.repoId === repoId)?.slug ?? null) : null
}

export function HqPlusTakePanel({
  item,
  onDone,
  onCancel
}: {
  item: PulseInboxItem
  /** The chat it went to, when it went to one that already exists. */
  onDone: (sessionId: string | null) => void
  onCancel: () => void
}): React.JSX.Element {
  const [request, setRequest] = useState<Request | null | 'loading'>('loading')
  const [repoId, setRepoId] = useState<string | null>(null)
  const [chat, setChat] = useState<string>(HQ_ROUTE_NEW_CHAT)
  const [text, setText] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    let live = true
    setRequest('loading')
    void loadRequest(item)
      .catch(() => null)
      .then((loaded) => {
        if (!live) {
          return
        }
        setRequest(loaded)
        setRepoId(loaded?.repoId ?? null)
        setChat(HQ_ROUTE_NEW_CHAT)
        setText(loaded?.text ?? '')
        setNote('')
      })
    return () => {
      live = false
    }
  }, [item])

  if (request === 'loading') {
    return (
      <p className="hqp-empty">{translate('auto.hqPlus.take.loading', 'Reading the request…')}</p>
    )
  }
  if (!request) {
    return (
      <div className="hqp-take">
        <p className="hqp-empty">
          {translate('auto.hqPlus.take.gone', 'This request is already decided.')}
        </p>
        <div className="hqp-row-f">
          <span className="hqp-spacer" />
          <button type="button" className="hqp-pill" onClick={onCancel}>
            {translate('auto.hqPlus.take.back', 'Back')}
          </button>
        </div>
      </div>
    )
  }

  const send = async (): Promise<void> => {
    if (!repoId) {
      return
    }
    const projectName = repoName(repoId)
    const draft = request.draft
    if (draft && chat === HQ_ROUTE_NEW_CHAT) {
      const slug = await slugOfRepo(repoId)
      if (slug) {
        const taken = await doHqSlackRequest({ ...draft, project: slug, description: text })
        if (taken) {
          onDone(null)
        }
        return
      }
    }
    const target = hqRouteTargetFor(repoId, chat, (draft?.title ?? request.title).slice(0, 60))
    if (!target) {
      toast.error(translate('auto.hqIntake.noTarget', 'Pick a project and a chat first'))
      return
    }
    const intake = draft ? null : readHqIntake(item.refId)
    const prompt = intake
      ? hqIntakePrompt({ ...intake, text }, { projectName, note })
      : hqRequestTakePrompt(
          {
            source: draft?.source === 'clickup' ? 'ClickUp' : 'Slack',
            author: request.author,
            link: draft?.permalink || null,
            text
          },
          { projectName, note }
        )
    if (!(await sendHqRoutePrompt(target, prompt))) {
      return
    }
    const where = target.kind === 'chat' ? `«${target.chat.title}»` : `a new chat «${target.name}»`
    if (intake) {
      await window.api.pulseBell.closeIntake(item.id, 'sent', `Sent to ${where}`)
    } else if (draft) {
      await window.api.hqProjects.takeSlackDraft({ id: draft.id })
    }
    toast.success(translate('auto.hqPlus.take.sent', 'Sent to {{where}}', { where }))
    onDone(target.kind === 'chat' ? target.chat.sessionId : null)
  }

  return (
    <form
      className="hqp-take"
      onSubmit={(event) => {
        event.preventDefault()
        setBusy(true)
        void send()
          .catch((error: unknown) => toast.error(String(error)))
          .finally(() => setBusy(false))
      }}
    >
      <p className="hqp-agents-sum">{translate('auto.hqPlus.take.title', 'To work')}</p>
      <strong className="hqp-take-h">{request.title}</strong>
      <HqRouteForm
        repoId={repoId}
        onRepoChange={(next) => {
          setRepoId(next)
          setChat(HQ_ROUTE_NEW_CHAT)
        }}
        chat={chat}
        onChatChange={setChat}
        note={note}
        onNoteChange={setNote}
        disabled={busy}
        portal={null}
      />
      <label className="hqp-take-l">
        <span>{translate('auto.hqPlus.take.request', 'Request')}</span>
        <Textarea
          value={text}
          disabled={busy}
          rows={8}
          onChange={(event) => setText(event.target.value)}
        />
      </label>
      <div className="hqp-opts hqp-take-acts">
        <span className="hqp-spacer" />
        <button type="button" className="hqp-opt" data-ghost="true" onClick={onCancel}>
          {translate('auto.hqPlus.take.cancel', 'Cancel')}
        </button>
        <button
          type="submit"
          className="hqp-opt"
          data-main="true"
          disabled={busy || !repoId || !text.trim()}
        >
          {chat === HQ_ROUTE_NEW_CHAT
            ? translate('auto.hqPlus.take.startNew', 'Start a new chat')
            : translate('auto.hqPlus.take.sendChat', 'Send to the chat')}
        </button>
      </div>
    </form>
  )
}

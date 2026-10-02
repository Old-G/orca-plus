// Custom build (hq): the «Today» tab's review requests — pull and merge requests on GitHub and
// GitLab that wait on the user's review, each opening in the browser.
import { useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import type { HqReviewsResult } from '../../../../../shared/hq-project-pages'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import { formatShortTimeAgo } from '@/lib/short-time-ago'
import { ColumnHeader } from './hq-waiting-parts'

type ReviewsState =
  | { status: 'loading' }
  | { status: 'ready'; result: HqReviewsResult }
  | { status: 'error'; message: string }

function useHqReviewRequests(): { state: ReviewsState; refresh: () => void } {
  const [state, setState] = useState<ReviewsState>({ status: 'loading' })
  const [request, setRequest] = useState({ nonce: 0, refresh: false })
  useEffect(() => {
    let alive = true
    window.api.hqProjects
      .reviews(request.refresh)
      .then((result) => {
        if (alive) {
          setState({ status: 'ready', result })
        }
      })
      .catch((error: unknown) => {
        if (alive) {
          setState({ status: 'error', message: String(error) })
        }
      })
    return () => {
      alive = false
    }
  }, [request])
  return {
    state,
    refresh: () => {
      setState({ status: 'loading' })
      setRequest((previous) => ({ nonce: previous.nonce + 1, refresh: true }))
    }
  }
}

export function HqTodayReviewRequests({ now }: { now: number }): React.JSX.Element {
  const { state, refresh } = useHqReviewRequests()
  const title = translate('auto.hq.today.reviewRequests', 'Waiting on your review')
  const reviews = state.status === 'ready' ? state.result.reviews : []
  const errors = state.status === 'ready' ? state.result.errors : []
  return (
    <section className="flex flex-col gap-2" aria-label={title}>
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <ColumnHeader title={title} count={reviews.length} />
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          onClick={refresh}
          disabled={state.status === 'loading'}
          aria-label={translate('auto.hq.today.refreshReviews', 'Refresh reviews')}
        >
          <RefreshCw />
        </Button>
      </div>
      {state.status === 'loading' ? (
        <p className="text-xs text-muted-foreground">
          {translate('auto.hq.waiting.loading', 'Loading…')}
        </p>
      ) : null}
      {state.status === 'error' ? (
        <p className="text-xs text-destructive">{state.message}</p>
      ) : null}
      {errors.map((error) => (
        <p key={error} className="text-xs text-destructive">
          {error}
        </p>
      ))}
      {state.status === 'ready' && reviews.length === 0 && errors.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          {translate('auto.hq.today.noReviewRequests', 'Nobody is waiting on your review.')}
        </p>
      ) : null}
      {reviews.length > 0 ? (
        <ul className="flex flex-col">
          {reviews.map((review) => (
            <li key={review.url}>
              <button
                type="button"
                onClick={() => void window.api.shell.openUrl(review.url)}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px]">{review.title}</span>
                  <span className="block truncate font-mono text-[11px] text-muted-foreground">
                    {review.ref}
                    {review.author ? ` · ${review.author}` : ''}
                    {review.draft ? ` · ${translate('auto.hq.today.draft', 'draft')}` : ''}
                  </span>
                </span>
                {review.updatedAt ? (
                  <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">
                    {formatShortTimeAgo(review.updatedAt, now)}
                  </span>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  )
}

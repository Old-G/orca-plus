// Custom build (hq-plus-map): the room's map — its hub on the left, the sources it hears from (Slack,
// ClickUp, mail, GitLab), the projects they feed and, for an unfolded project, the talks that wait on the
// owner, the people it waits on and its chats. Drag pans, ⌘/Ctrl + wheel or +/− zooms, Fit shows it all;
// a click on a project unfolds it, a second click folds it back.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { HqPlusMapLeaf, HqPlusMapModel } from '../../../../../shared/hq-plus-map'
import type { HqChatItem } from '../hq/hq-chat-list'
import type { HqPlusMapCamera } from './hq-plus-map-view'
import { HqPlusMapChatClose, HqPlusMapLeafView, HqPlusMapProjectBody } from './HqPlusMapLeaf'
import type { HqPlusChatCloser } from './HqPlusCloseChat'
import {
  AMBER,
  H_PRJ,
  H_SRC,
  HQ_PLUS_SOURCE_COLOR,
  HQ_PLUS_SOURCE_NAME,
  HUB_X,
  LEAF_H,
  MAX_K,
  MIN_K,
  TOP,
  W_LEAF,
  W_PRJ,
  W_SRC,
  X_LEAF,
  X_PRJ,
  X_SRC,
  curve,
  leafHot,
  placeRows,
  srcY,
  trunc
} from './hq-plus-map-geometry'

export type HqPlusMapPick =
  | { kind: 'project'; slug: string }
  | { kind: 'leaf'; slug: string; key: string }

export function HqPlusMap({
  hub,
  model,
  expanded,
  pick,
  camera,
  now,
  chats,
  closerOfChat,
  onCamera,
  onPickProject,
  onPickLeaf,
  onClear
}: {
  hub: { letters: string; name: string }
  model: HqPlusMapModel
  expanded: ReadonlySet<string>
  pick: HqPlusMapPick | null
  camera: HqPlusMapCamera | null
  now: number
  /** The room's open chats by key, for the chat leaves' names. */
  chats: ReadonlyMap<string, HqChatItem>
  /** × on a chat leaf; null keeps the leaf without one. */
  closerOfChat: (chatKey: string) => HqPlusChatCloser | null
  onCamera: (camera: HqPlusMapCamera) => void
  onPickProject: (slug: string) => void
  onPickLeaf: (slug: string, leaf: HqPlusMapLeaf) => void
  onClear: () => void
}): React.JSX.Element {
  const frame = useRef<HTMLDivElement>(null)
  const [cam, setCam] = useState<HqPlusMapCamera>(camera ?? { x: 12, y: 8, k: 0.8 })
  const [glide, setGlide] = useState(false)
  // Why: wheel and drag read the camera between renders; the ref is its latest value.
  const camRef = useRef(cam)
  camRef.current = cam
  const onCameraRef = useRef(onCamera)
  onCameraRef.current = onCamera
  const drag = useRef<{ x: number; y: number; cx: number; cy: number; moved: boolean } | null>(null)
  const suppressClick = useRef(false)
  const { top, height } = placeRows(model.projects, expanded)
  const hubY =
    model.sources.length > 0 ? srcY((model.sources.length - 1) / 2) + H_SRC / 2 : TOP + H_PRJ / 2
  const anyOpen = model.projects.some((project) => expanded.has(project.slug))
  const contentW = (anyOpen ? X_LEAF + W_LEAF : X_PRJ + W_PRJ) + 24
  const contentH = Math.max(height, srcY(model.sources.length) + 20)

  const move = useCallback((next: HqPlusMapCamera, smooth: boolean) => {
    camRef.current = next
    setGlide(smooth)
    setCam(next)
    onCameraRef.current(next)
  }, [])
  const fit = useCallback(() => {
    const box = frame.current?.getBoundingClientRect()
    if (!box || box.width === 0) {
      return
    }
    const k = Math.max(
      MIN_K,
      Math.min(1.1, (box.width - 24) / contentW, (box.height - 24) / contentH)
    )
    move({ x: 12, y: 12, k }, true)
  }, [contentW, contentH, move])
  // Why: a first visit has no remembered zoom; the whole map fits the window once it has a size.
  useLayoutEffect(() => {
    if (!camera) {
      fit()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const zoomAt = useCallback(
    (factor: number, px: number, py: number) => {
      const current = camRef.current
      const k = Math.max(MIN_K, Math.min(MAX_K, current.k * factor))
      move(
        {
          k,
          x: px - ((px - current.x) * k) / current.k,
          y: py - ((py - current.y) * k) / current.k
        },
        false
      )
    },
    [move]
  )
  useEffect(() => {
    const node = frame.current
    if (!node) {
      return
    }
    // Why: a plain wheel pans like a page; with ⌘/Ctrl (or a pinch) it zooms at the pointer.
    const onWheel = (event: WheelEvent): void => {
      event.preventDefault()
      const box = node.getBoundingClientRect()
      if (event.ctrlKey || event.metaKey) {
        zoomAt(Math.exp(-event.deltaY * 0.0022), event.clientX - box.left, event.clientY - box.top)
        return
      }
      const current = camRef.current
      move({ ...current, x: current.x - event.deltaX, y: current.y - event.deltaY }, false)
    }
    node.addEventListener('wheel', onWheel, { passive: false })
    return () => node.removeEventListener('wheel', onWheel)
  }, [zoomAt, move])
  // Why: an unfolded project slides into view when it would open below the window's edge.
  const pickedSlug = pick?.slug ?? null
  useEffect(() => {
    const y = pickedSlug ? top.get(pickedSlug) : undefined
    const box = frame.current?.getBoundingClientRect()
    if (y === undefined || !box) {
      return
    }
    const screenY = cam.y + y * cam.k
    const leaves = expanded.has(pickedSlug ?? '')
      ? (model.projects.find((p) => p.slug === pickedSlug)?.leaves.length ?? 0)
      : 0
    const bottom = screenY + Math.max(H_PRJ, leaves * LEAF_H) * cam.k
    if (screenY < 0 || bottom > box.height) {
      move({ ...cam, y: 40 - y * cam.k }, true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickedSlug, expanded])

  const middle = (): [number, number] => {
    const box = frame.current?.getBoundingClientRect()
    return box ? [box.width / 2, box.height / 2] : [0, 0]
  }
  const lod = cam.k < 0.62 ? 'far' : cam.k > 1.2 ? 'near' : 'mid'
  const focus = pick?.slug ?? null
  const dim = (slug: string | null): string => (focus && slug !== focus ? 'hqm-dim' : '')
  const click = (handler: () => void) => (event: React.MouseEvent) => {
    event.stopPropagation()
    if (!suppressClick.current) {
      handler()
    }
  }

  return (
    <div
      ref={frame}
      className="hqm-map"
      data-lod={lod}
      onPointerDown={(event) => {
        if ((event.target as Element).closest('.hqm-tools')) {
          return
        }
        drag.current = { x: event.clientX, y: event.clientY, cx: cam.x, cy: cam.y, moved: false }
        suppressClick.current = false
      }}
      onPointerMove={(event) => {
        const start = drag.current
        if (!start) {
          return
        }
        const dx = event.clientX - start.x
        const dy = event.clientY - start.y
        if (!start.moved && Math.abs(dx) + Math.abs(dy) > 4) {
          start.moved = true
          event.currentTarget.setPointerCapture(event.pointerId)
        }
        if (start.moved) {
          setGlide(false)
          setCam({ ...camRef.current, x: start.cx + dx, y: start.cy + dy })
        }
      }}
      onPointerUp={() => {
        if (drag.current?.moved) {
          suppressClick.current = true
          onCameraRef.current(camRef.current)
        }
        drag.current = null
      }}
      onClick={() => {
        if (!suppressClick.current) {
          onClear()
        }
        suppressClick.current = false
      }}
    >
      <div className="hqm-zoom">
        {lod === 'far' ? 'OVERVIEW' : lod === 'mid' ? 'PROJECTS' : 'DETAILS'} ·{' '}
        {Math.round(cam.k * 100)}%
      </div>
      <div className="hqm-tools">
        <button type="button" aria-label="Zoom in" onClick={() => zoomAt(1.25, ...middle())}>
          +
        </button>
        <button type="button" aria-label="Zoom out" onClick={() => zoomAt(0.8, ...middle())}>
          −
        </button>
        <button type="button" onClick={fit}>
          Fit
        </button>
      </div>
      <svg className="hqm-svg" aria-hidden="true">
        <defs>
          <filter id="hqm-glow" x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="3" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <radialGradient id="hqm-orb" cx="50%" cy="40%" r="60%">
            <stop offset="0" stopColor="#1d3a4a" />
            <stop offset="1" stopColor="#08131c" />
          </radialGradient>
        </defs>
        <g
          style={{
            transform: `translate(${cam.x}px, ${cam.y}px) scale(${cam.k})`,
            transformOrigin: '0 0',
            transition: glide ? 'transform 0.42s cubic-bezier(0.22, 0.8, 0.2, 1)' : 'none'
          }}
        >
          {/* edges: hub → sources, sources → projects, hub → projects nobody feeds, project → leaves */}
          {model.sources.map(({ source }, index) => (
            <path
              key={`h-${source}`}
              d={curve(HUB_X + 46, hubY, X_SRC, srcY(index) + H_SRC / 2)}
              className={`hqm-edge ${focus && !model.projects.find((p) => p.slug === focus)?.sources[source] ? 'hqm-dim' : ''}`}
              stroke={HQ_PLUS_SOURCE_COLOR[source]}
              strokeWidth={2.2}
              opacity={0.5}
            />
          ))}
          {model.projects.flatMap((project) => {
            const py = (top.get(project.slug) ?? 0) + H_PRJ / 2
            const fed = model.sources.flatMap(({ source }, index) => {
              const count = project.sources[source]
              return count
                ? [
                    <path
                      key={`s-${source}-${project.slug}`}
                      d={curve(X_SRC + W_SRC, srcY(index) + H_SRC / 2, X_PRJ, py)}
                      className={`hqm-edge ${dim(project.slug)}`}
                      stroke={HQ_PLUS_SOURCE_COLOR[source]}
                      strokeWidth={(1 + Math.log2(count + 1) * 1.1).toFixed(1)}
                      opacity={focus === project.slug ? 0.95 : 0.32}
                      filter={focus === project.slug ? 'url(#hqm-glow)' : undefined}
                    />
                  ]
                : []
            })
            const own =
              fed.length === 0
                ? [
                    <path
                      key={`h-${project.slug}`}
                      d={curve(HUB_X + 46, hubY, X_PRJ, py)}
                      className={`hqm-edge ${dim(project.slug)}`}
                      stroke="#3a5562"
                      strokeWidth={1}
                      strokeDasharray="3 5"
                      opacity={0.6}
                    />
                  ]
                : []
            const leaves = expanded.has(project.slug)
              ? project.leaves.map((leaf, index) => {
                  const ly = (top.get(project.slug) ?? 0) + index * LEAF_H + (LEAF_H - 6) / 2
                  const hot = leafHot(leaf)
                  return (
                    <path
                      key={`l-${project.slug}-${leaf.key}`}
                      d={curve(X_PRJ + W_PRJ, py, X_LEAF, ly)}
                      className={`hqm-edge ${dim(project.slug)}`}
                      stroke={hot ? AMBER : '#2e4652'}
                      strokeWidth={hot ? 1.6 : 1}
                      opacity={0.75}
                    />
                  )
                })
              : []
            return [...fed, ...own, ...leaves]
          })}

          <g transform={`translate(${HUB_X},${hubY})`}>
            <circle r={58} fill="none" stroke="#173040" strokeDasharray="2 5" />
            <circle r={46} fill="url(#hqm-orb)" stroke="#3a6578" strokeWidth={1.5} />
            <text y={7} textAnchor="middle" className="hqm-hub">
              {hub.letters}
            </text>
            <text y={76} textAnchor="middle" className="hqm-sub">
              {trunc(hub.name, 22)}
            </text>
          </g>

          {model.sources.map(({ source, count }, index) => (
            <g
              key={source}
              transform={`translate(${X_SRC},${srcY(index)})`}
              className={
                focus && !model.projects.find((p) => p.slug === focus)?.sources[source]
                  ? 'hqm-dim'
                  : ''
              }
            >
              <rect
                width={W_SRC}
                height={H_SRC}
                rx={10}
                className="hqm-src"
                stroke={HQ_PLUS_SOURCE_COLOR[source]}
              />
              <circle cx={15} cy={17} r={4} fill={HQ_PLUS_SOURCE_COLOR[source]} />
              <text x={27} y={21} className="hqm-name">
                {HQ_PLUS_SOURCE_NAME[source]}
              </text>
              <text x={15} y={37} className="hqm-sub hqm-lod-mid">
                {count} {count === 1 ? 'conversation' : 'conversations'}
              </text>
            </g>
          ))}

          {model.projects.map((project) => {
            const y = top.get(project.slug) ?? 0
            const open = expanded.has(project.slug)
            const picked = pick?.kind === 'project' && pick.slug === project.slug
            return (
              <g key={project.slug}>
                <g
                  className={`hqm-node ${picked ? 'hqm-sel' : ''} ${dim(project.slug)}`}
                  transform={`translate(${X_PRJ},${y})`}
                  onClick={click(() => onPickProject(project.slug))}
                >
                  <HqPlusMapProjectBody project={project} open={open} now={now} />
                </g>
                {open
                  ? project.leaves.map((leaf, index) => {
                      const closer = leaf.kind === 'chat' ? closerOfChat(leaf.chatKey) : null
                      return (
                        <g
                          key={leaf.key}
                          className={`hqm-node ${pick?.kind === 'leaf' && pick.slug === project.slug && pick.key === leaf.key ? 'hqm-sel' : ''} ${dim(project.slug)}`}
                          transform={`translate(${X_LEAF},${y + index * LEAF_H})`}
                          onClick={click(() => onPickLeaf(project.slug, leaf))}
                        >
                          <rect className="hqm-box" width={W_LEAF} height={LEAF_H - 6} rx={8} />
                          <HqPlusMapLeafView
                            leaf={leaf}
                            now={now}
                            chat={leaf.kind === 'chat' ? chats.get(leaf.chatKey) : undefined}
                            closable={closer !== null}
                          />
                          {closer ? <HqPlusMapChatClose closer={closer} /> : null}
                        </g>
                      )
                    })
                  : null}
              </g>
            )
          })}
        </g>
      </svg>
    </div>
  )
}

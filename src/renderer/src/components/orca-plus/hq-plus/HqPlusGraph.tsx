// Custom build (hq-plus-ui): Граф — three columns, people → projects → the systems those projects lean
// on; dashed lines are waits (red when old), and a click on a node lights only its neighbours.
import { useMemo, useState } from 'react'
import {
  HQ_PLUS_OWNER_NODE,
  type HqPlusGraph as Graph,
  type HqPlusGraphEdge
} from '../../../../../shared/hq-plus-river-graph'
import { translate } from '@/i18n/i18n'

const WIDTH = 540
const COLUMN_X = [116, 300, 456] as const
const LABEL_MAX = 16
const TOP = 46
const ROW_MIN = 56
const HEIGHT_MIN = 320

const EDGE_COLOR: Record<HqPlusGraphEdge['kind'], string> = {
  relation: 'var(--hqp-rel)',
  'wait-long': 'var(--hqp-red)',
  wait: 'var(--hqp-amber)',
  owe: 'var(--hqp-ice)',
  member: 'var(--hqp-rel)'
}

type Placed = { id: string; label: string; x: number; y: number; column: 0 | 1 | 2 }

function place(ids: { id: string; label: string }[], column: 0 | 1 | 2, height: number): Placed[] {
  const step = ids.length > 1 ? (height - TOP - 24) / (ids.length - 1) : 0
  return ids.map((node, index) => ({
    ...node,
    label: node.label.length > LABEL_MAX ? `${node.label.slice(0, LABEL_MAX - 1)}…` : node.label,
    column,
    x: COLUMN_X[column],
    y: ids.length > 1 ? TOP + index * step : (height + TOP) / 2 - 12
  }))
}

export function HqPlusGraph({
  graph,
  roomColor,
  onPickProject
}: {
  graph: Graph
  roomColor: (room: string) => string | null
  onPickProject: (project: string) => void
}): React.JSX.Element {
  const rows = Math.max(graph.people.length, graph.projects.length, graph.systems.length, 1)
  const height = Math.max(HEIGHT_MIN, TOP + rows * ROW_MIN)
  const nodes = useMemo(() => {
    const placed = [
      ...place(graph.people, 0, height),
      ...place(graph.projects, 1, height),
      ...place(graph.systems, 2, height)
    ]
    return new Map(placed.map((node) => [node.id, node]))
  }, [graph, height])
  const [picked, setPicked] = useState<string | null>(null)
  const selected = picked && nodes.has(picked) ? picked : null
  const near = useMemo(() => {
    if (!selected) {
      return null
    }
    const set = new Set([selected])
    for (const edge of graph.edges) {
      if (edge.from === selected) {
        set.add(edge.to)
      }
      if (edge.to === selected) {
        set.add(edge.from)
      }
    }
    return set
  }, [graph.edges, selected])

  if (nodes.size === 0) {
    return (
      <p className="hqp-empty hqp-quiet">
        {translate('auto.hqPlus.graph.empty', 'Nobody holds anything up, and no project moved.')}
      </p>
    )
  }

  const info = (): React.ReactNode => {
    if (!selected) {
      return translate(
        'auto.hqPlus.graph.hint',
        'Click a person, project or system to see what it is tied to.'
      )
    }
    const node = nodes.get(selected)
    const person = graph.people.find((candidate) => candidate.id === selected)
    const waits = graph.edges.filter(
      (edge) => edge.from === selected && (edge.kind === 'wait' || edge.kind === 'wait-long')
    )
    const linked = graph.edges
      .filter((edge) => edge.from === selected || edge.to === selected)
      .map((edge) => nodes.get(edge.from === selected ? edge.to : edge.from)?.label)
      .filter((label): label is string => Boolean(label))
    if (person?.owner) {
      return (
        <>
          {translate('auto.hqPlus.graph.owner', 'You owe an answer to: {{who}}.', {
            who: linked.join(', ')
          })}
          <button
            type="button"
            className="hqp-chip-btn hqp-ginfo-go"
            onClick={() => setPicked(null)}
          >
            {translate('auto.hqPlus.graph.clear', 'Clear')}
          </button>
        </>
      )
    }
    return (
      <>
        <span className="hqp-ginfo-sel">
          {translate('auto.hqPlus.graph.selected', 'Selected:')}
        </span>{' '}
        <b>{node?.label}</b>
        {person && waits.length > 0
          ? ` ${translate('auto.hqPlus.graph.holds', 'holds up {{projects}} ({{detail}}).', {
              projects: waits.map((edge) => nodes.get(edge.to)?.label ?? edge.to).join(', '),
              detail: person.detail
            })}`
          : linked.length > 0
            ? ` — ${linked.join(', ')}`
            : ''}
        <button type="button" className="hqp-chip-btn hqp-ginfo-go" onClick={() => setPicked(null)}>
          {translate('auto.hqPlus.graph.clear', 'Clear')}
        </button>
        {graph.projects.some((project) => project.id === selected) ? (
          <button
            type="button"
            className="hqp-chip-btn hqp-ginfo-go"
            onClick={() => onPickProject(selected)}
          >
            {translate('auto.hqPlus.graph.openSession', 'Session')} →
          </button>
        ) : null}
      </>
    )
  }

  return (
    <div className="hqp-graph">
      <svg
        viewBox={`0 0 ${WIDTH} ${height}`}
        role="img"
        aria-label={translate('auto.hqPlus.graph.label', 'Graph: people, projects, systems')}
        // Custom build (hq-plus-ui-v3): a click on empty space clears the selection.
        onClick={(event) => {
          if (event.target === event.currentTarget) {
            setPicked(null)
          }
        }}
      >
        {[
          translate('auto.hqPlus.graph.people', 'PEOPLE'),
          translate('auto.hqPlus.graph.projects', 'PROJECTS'),
          translate('auto.hqPlus.graph.systems', 'SYSTEMS')
        ].map((label, column) => (
          <text
            key={label}
            x={COLUMN_X[column]}
            y={16}
            textAnchor="middle"
            style={{ fill: 'var(--hqp-axis)' }}
            fontSize={10}
            letterSpacing={2.5}
            fontFamily="var(--font-mono)"
          >
            {label}
          </text>
        ))}
        {graph.edges.map((edge) => {
          const from = nodes.get(edge.from)
          const to = nodes.get(edge.to)
          if (!from || !to) {
            return null
          }
          const flow = edge.kind !== 'relation' && edge.kind !== 'member'
          const lit = !selected || edge.from === selected || edge.to === selected
          return (
            <path
              key={`${edge.from}>${edge.to}:${edge.kind}`}
              className={`${lit ? '' : 'dim '}${flow ? 'flow' : 'rel'}`}
              d={`M${from.x} ${from.y} Q ${(from.x + to.x) / 2} ${(from.y + to.y) / 2 - 14} ${to.x} ${to.y}`}
              fill="none"
              stroke={EDGE_COLOR[edge.kind]}
              strokeWidth={flow ? 2 : 1.3}
              strokeOpacity={flow ? 0.9 : 0.7}
              strokeDasharray={flow ? '5 5' : undefined}
            />
          )
        })}
        {[...nodes.values()].map((node) => {
          const dim = near !== null && !near.has(node.id)
          const project = graph.projects.find((candidate) => candidate.id === node.id)
          const color = project ? (roomColor(project.room) ?? 'var(--hqp-blue)') : 'var(--hqp-blue)'
          const width = node.label.length * 6.4 + 18
          const pick = (): void => {
            setPicked(node.id === selected ? null : node.id)
          }
          return (
            <g
              key={node.id}
              className={`nd${dim ? ' dim' : ''}`}
              tabIndex={0}
              role="button"
              aria-label={node.label || translate('auto.hqPlus.graph.you', 'you')}
              onClick={pick}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  pick()
                }
              }}
            >
              {node.id === HQ_PLUS_OWNER_NODE ? (
                <>
                  <circle
                    cx={node.x}
                    cy={node.y}
                    r={16}
                    style={{ fill: 'var(--hqp-ice-ink)', stroke: 'var(--hqp-ice)' }}
                    strokeWidth={1.5}
                  />
                  <circle
                    cx={node.x}
                    cy={node.y}
                    r={24}
                    strokeOpacity={0.25}
                    style={{ fill: 'none', stroke: 'var(--hqp-ice)' }}
                  />
                  <text
                    x={node.x}
                    y={node.y + 4}
                    textAnchor="middle"
                    style={{ fill: 'var(--hqp-fg)' }}
                    fontSize={11}
                    fontWeight={600}
                  >
                    {translate('auto.hqPlus.graph.you', 'you')}
                  </text>
                </>
              ) : node.column === 0 ? (
                <>
                  <circle
                    cx={node.x}
                    cy={node.y}
                    r={8}
                    style={{ fill: 'var(--hqp-node)', stroke: 'var(--hqp-ice)' }}
                    strokeWidth={1.2}
                  />
                  <text
                    x={node.x - 14}
                    y={node.y + 4}
                    textAnchor="end"
                    style={{ fill: 'var(--hqp-fg)' }}
                    fontSize={11.5}
                  >
                    {node.label}
                  </text>
                </>
              ) : (
                <>
                  <rect
                    x={node.x - width / 2}
                    y={node.y - 11}
                    width={width}
                    height={22}
                    rx={8}
                    fill={color}
                    fillOpacity={node.column === 1 ? 0.2 : 0.08}
                    stroke={color}
                    strokeOpacity={node.column === 1 ? 0.9 : 0.45}
                  />
                  <text
                    x={node.x}
                    y={node.y + 4}
                    textAnchor="middle"
                    style={{ fill: node.column === 1 ? 'var(--hqp-fg)' : 'var(--hqp-mute)' }}
                    fontSize={11}
                  >
                    {node.label}
                  </text>
                  {project?.active ? (
                    <circle
                      cx={node.x + width / 2}
                      cy={node.y - 11}
                      r={4}
                      style={{ fill: 'var(--hqp-green)' }}
                    />
                  ) : null}
                </>
              )}
            </g>
          )
        })}
      </svg>
      <div className="hqp-ginfo">{info()}</div>
      <div className="hqp-legend">
        <span>
          <i
            className="hqp-sw"
            data-dash="true"
            style={{ borderTopColor: EDGE_COLOR['wait-long'] }}
          />
          {translate('auto.hqPlus.graph.legendLong', 'waiting 2+ days')}
        </span>
        <span>
          <i className="hqp-sw" data-dash="true" style={{ borderTopColor: EDGE_COLOR.wait }} />
          {translate('auto.hqPlus.graph.legendWait', 'waiting')}
        </span>
        <span>
          <i className="hqp-sw" style={{ borderTopColor: EDGE_COLOR.relation }} />
          {translate('auto.hqPlus.graph.legendRel', 'depends on')}
        </span>
        <span>
          <i className="hqp-sw" data-dash="true" style={{ borderTopColor: EDGE_COLOR.owe }} />
          {translate('auto.hqPlus.graph.legendOwe', 'you owe')}
        </span>
      </div>
    </div>
  )
}

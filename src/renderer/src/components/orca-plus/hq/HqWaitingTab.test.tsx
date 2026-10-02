// @vitest-environment happy-dom

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/i18n/i18n', () => ({
  translate: (_key: string, fallback: string, options?: Record<string, string>) =>
    fallback.replace('{{value0}}', options?.value0 ?? '')
}))
vi.mock('@/lib/web-client-location', () => ({ isWebClientLocation: () => false }))

import { HqWaitingTab } from './HqWaitingTab'

const DAY = 86_400_000

type Call = { method: string; params?: unknown }

function field(params: unknown, key: string): unknown {
  return typeof params === 'object' && params !== null ? Reflect.get(params, key) : undefined
}

function installPulse(snapshot: {
  people: { id: string; name: string }[]
  waitings: Record<string, unknown>[]
  decisions: Record<string, unknown>[]
}) {
  const calls: Call[] = []
  let notify: () => void = () => {}
  const call = vi.fn(async ({ method, params }: Call) => {
    calls.push({ method, params })
    if (method === 'pulse.snapshot') {
      return { id: 'r', ok: true, result: structuredClone(snapshot) }
    }
    if (method === 'pulse.upsertPerson') {
      const person = { id: `p-${snapshot.people.length + 1}`, name: String(field(params, 'name')) }
      snapshot.people.push(person)
      return { id: 'r', ok: true, result: person }
    }
    if (method === 'pulse.addWaiting') {
      snapshot.waitings.unshift({
        id: 'w-new',
        createdAt: Date.now(),
        dueAt: null,
        ...Object(params)
      })
      queueMicrotask(() => notify())
      return { id: 'r', ok: true, result: {} }
    }
    if (method === 'pulse.closeWaiting') {
      snapshot.waitings = snapshot.waitings.filter((w) => w.id !== field(params, 'id'))
      queueMicrotask(() => notify())
      return { id: 'r', ok: true, result: {} }
    }
    return { id: 'r', ok: false, error: { code: 'unknown', message: `no ${method}` } }
  })
  Object.assign(window, {
    api: {
      runtime: { call },
      pulseBell: {
        onChanged: (callback: () => void) => {
          notify = callback
          return () => {
            notify = () => {}
          }
        }
      }
    }
  })
  return { calls, snapshot }
}

let pulse: ReturnType<typeof installPulse>

beforeEach(() => {
  pulse = installPulse({
    people: [{ id: 'p-1', name: 'Laura' }],
    waitings: [
      {
        id: 'w-1',
        direction: 'on-me',
        title: 'Answer about the budget',
        personId: 'p-1',
        project: 'shop',
        createdAt: Date.now() - 2 * DAY - 1000,
        dueAt: Date.now() - DAY
      },
      { id: 'broken', direction: 'sideways', title: 'dropped', createdAt: 1 }
    ],
    decisions: [
      {
        id: 'd-1',
        kind: 'approval',
        title: 'Send the release note',
        outcome: 'rejected',
        decidedAt: Date.now() - 3_600_000
      },
      { id: 'd-2', kind: 'decision', title: 'Ship on Monday', outcome: null, decidedAt: Date.now() }
    ]
  })
})

afterEach(() => {
  cleanup()
})

describe('HqWaitingTab', () => {
  it('splits open waitings by direction, with person, project, age and an overdue date', async () => {
    render(<HqWaitingTab />)
    const onMe = await screen.findByRole('region', { name: 'Waiting on me' })
    expect(within(onMe).getByText('Answer about the budget')).toBeTruthy()
    expect(within(onMe).getByText('Laura · shop · 2d')).toBeTruthy()
    expect(within(onMe).getByText(/^due /).getAttribute('data-overdue')).toBe('true')
    expect(screen.queryByText('dropped')).toBeNull()

    const onThem = screen.getByRole('region', { name: "I'm waiting on" })
    expect(within(onThem).getByText("You're not waiting on anyone.")).toBeTruthy()

    const decisions = screen.getByRole('region', { name: 'Recent decisions' })
    expect(within(decisions).getByText('Rejected')).toBeTruthy()
    expect(within(decisions).getByText('Decision')).toBeTruthy()
  })

  it('adds a waiting for a new person, then shows it once main reports the write', async () => {
    render(<HqWaitingTab />)
    const onThem = await screen.findByRole('region', { name: "I'm waiting on" })
    fireEvent.change(within(onThem).getByLabelText('What is waiting'), {
      target: { value: '  Contract draft ' }
    })
    fireEvent.change(within(onThem).getByLabelText('Person'), { target: { value: 'Mark' } })
    fireEvent.click(within(onThem).getByRole('button', { name: 'Add' }))

    expect(await within(onThem).findByText('Contract draft')).toBeTruthy()
    expect(within(onThem).getByText(/^Mark · now$/)).toBeTruthy()
    const writes = pulse.calls.filter((c) => c.method !== 'pulse.snapshot')
    expect(writes).toEqual([
      { method: 'pulse.upsertPerson', params: { name: 'Mark' } },
      {
        method: 'pulse.addWaiting',
        params: { direction: 'on-them', title: 'Contract draft', source: 'manual', personId: 'p-2' }
      }
    ])
  })

  it('reuses a known person whatever the case, and needs no person at all', async () => {
    render(<HqWaitingTab />)
    const onMe = await screen.findByRole('region', { name: 'Waiting on me' })
    fireEvent.change(within(onMe).getByLabelText('What is waiting'), {
      target: { value: 'Review' }
    })
    fireEvent.change(within(onMe).getByLabelText('Person'), { target: { value: ' laura ' } })
    fireEvent.click(within(onMe).getByRole('button', { name: 'Add' }))
    await within(onMe).findByText('Review')

    fireEvent.change(within(onMe).getByLabelText('What is waiting'), { target: { value: 'Solo' } })
    fireEvent.submit(within(onMe).getByLabelText('What is waiting'))
    await waitFor(() =>
      expect(pulse.calls.filter((c) => c.method === 'pulse.addWaiting')).toHaveLength(2)
    )

    const adds = pulse.calls.filter((c) => c.method === 'pulse.addWaiting').map((c) => c.params)
    expect(adds).toEqual([
      { direction: 'on-me', title: 'Review', source: 'manual', personId: 'p-1' },
      { direction: 'on-me', title: 'Solo', source: 'manual' }
    ])
    expect(pulse.calls.some((c) => c.method === 'pulse.upsertPerson')).toBe(false)
  })

  it('closes a waiting as resolved on Done and as cancelled on Drop', async () => {
    pulse.snapshot.waitings.push({
      id: 'w-2',
      direction: 'on-them',
      title: 'Invoice',
      personId: null,
      project: null,
      createdAt: Date.now(),
      dueAt: null
    })
    render(<HqWaitingTab />)
    const onMe = await screen.findByRole('region', { name: 'Waiting on me' })
    fireEvent.click(within(onMe).getByRole('button', { name: 'Done' }))
    await waitFor(() => expect(screen.queryByText('Answer about the budget')).toBeNull())

    const onThem = screen.getByRole('region', { name: "I'm waiting on" })
    fireEvent.click(within(onThem).getByRole('button', { name: 'Drop' }))
    await waitFor(() => expect(screen.queryByText('Invoice')).toBeNull())

    expect(
      pulse.calls.filter((c) => c.method === 'pulse.closeWaiting').map((c) => c.params)
    ).toEqual([
      { id: 'w-1', status: 'resolved' },
      { id: 'w-2', status: 'cancelled' }
    ])
  })

  it('says so when the runtime answer is not a snapshot', async () => {
    vi.mocked(window.api.runtime.call).mockResolvedValueOnce({
      id: 'r',
      ok: true,
      result: 'nope',
      _meta: { runtimeId: 'local' }
    })
    await act(async () => {
      render(<HqWaitingTab />)
    })
    expect(screen.getByText(/^Couldn't read waitings:/)).toBeTruthy()
  })
})

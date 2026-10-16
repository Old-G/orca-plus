// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const toast = vi.hoisted(() => ({ success: vi.fn() }))
vi.mock('sonner', () => ({ toast }))
vi.mock('@/i18n/i18n', () => ({ translate: (_key: string, fallback: string) => fallback }))
vi.mock('../hq/HqCommandDictation', () => ({ HqCommandDictation: () => null }))

import { HqClickUpReplyComposer } from './HqClickUpReplyComposer'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

function api(over: Record<string, unknown> = {}) {
  const hqProjects = {
    draftClickUpReply: vi.fn(async () => ({ ok: true as const, text: 'Сегодня вечером.' })),
    sendClickUpReply: vi.fn(async () => ({ ok: true as const })),
    ...over
  }
  Object.assign(window, { api: { hqProjects } })
  return hqProjects
}

describe('HqClickUpReplyComposer', () => {
  it('fills the draft, sends the edited text with the original draft, then closes', async () => {
    const hqProjects = api()
    const onSent = vi.fn()
    render(<HqClickUpReplyComposer id="clickup:a:c1" onSent={onSent} onCancel={vi.fn()} />)
    const box = await screen.findByDisplayValue('Сегодня вечером.')
    expect(hqProjects.draftClickUpReply).toHaveBeenCalledWith({ id: 'clickup:a:c1' })

    fireEvent.change(box, { target: { value: ' Сегодня ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    await waitFor(() => expect(onSent).toHaveBeenCalled())
    expect(hqProjects.sendClickUpReply).toHaveBeenCalledWith({
      id: 'clickup:a:c1',
      text: 'Сегодня',
      draft: 'Сегодня вечером.'
    })
    expect(toast.success).toHaveBeenCalledWith('Reply posted in ClickUp.')
  })

  it('shows a failed draft and still lets the owner write and send his own', async () => {
    const hqProjects = api({
      draftClickUpReply: vi.fn(async () => ({ ok: false as const, error: 'No model' }))
    })
    render(<HqClickUpReplyComposer id="clickup:a:c1" onSent={vi.fn()} onCancel={vi.fn()} />)
    expect(await screen.findByText('No model')).toBeTruthy()
    const send = screen.getByRole('button', { name: 'Send' })
    expect(send.hasAttribute('disabled')).toBe(true)

    fireEvent.change(screen.getByRole('textbox', { name: 'Reply in ClickUp' }), {
      target: { value: 'Посмотрю' }
    })
    fireEvent.click(send)
    await waitFor(() =>
      expect(hqProjects.sendClickUpReply).toHaveBeenCalledWith({
        id: 'clickup:a:c1',
        text: 'Посмотрю'
      })
    )
  })

  it('keeps the text and shows why when ClickUp refuses the comment', async () => {
    api({ sendClickUpReply: vi.fn(async () => ({ ok: false as const, error: 'ClickUp 401' })) })
    const onSent = vi.fn()
    render(<HqClickUpReplyComposer id="clickup:a:c1" onSent={onSent} onCancel={vi.fn()} />)
    await screen.findByDisplayValue('Сегодня вечером.')
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    expect(await screen.findByText('ClickUp 401')).toBeTruthy()
    expect(screen.getByDisplayValue('Сегодня вечером.')).toBeTruthy()
    expect(onSent).not.toHaveBeenCalled()
  })
})

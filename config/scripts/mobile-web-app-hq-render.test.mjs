import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { chromium } from 'playwright-core'
import { buildMobileWebAppBundle } from './build-mobile-web-app-bundle.mjs'
import { mobileWebAppDependenciesPresent } from './mobile-web-app-bundle-dependencies.mjs'
import {
  createBundleServer,
  installShellDouble,
  readBridgeFaultGrant,
  readBridgeProtocolVersion,
  readShellCsp
} from './mobile-web-app-render-harness.mjs'

/**
 * Custom build (hq-mobile): HQ's page route in a real browser — the requests to the owner and what
 * was done for him, painted from the Mac's replies, and the verbs each button sends.
 * `ORCA_MOBILE_WEB_RENDER_SHOT` saves a screenshot of the first render for a visual check.
 */

const HOST_ROUTE = '/h/render-check-host'
const HQ_ROUTE = `${HOST_ROUTE}/hq`
const PAGE_ROUTE_PATTERNS = ['/h/[hostId]', '/h/[hostId]/hq']
const HQ_GRANTS = ['navigate', 'storage', 'externalLink', 'haptics']
const SHELL_HOST = {
  id: 'render-check-host',
  name: 'Render Check Host',
  endpoint: 'ws://render-check',
  lastConnected: 1
}

const NOW = Date.now()
const REPLIES = {
  'hqProjects.slackDrafts': {
    ok: true,
    configured: true,
    lastRunAt: null,
    failedAt: null,
    drafts: [
      {
        id: 'D1:1.1',
        kind: 'do',
        channelName: 'DM Ирина',
        author: 'Ирина',
        permalink: 'https://lev.slack.com/archives/D1/p11',
        quote: 'проверь тикеты',
        ask: 'Проверь тикеты по возвратам',
        title: 'Тикеты по возвратам',
        description: '',
        project: 'lh_support_ai_service',
        foundAt: new Date(NOW).toISOString()
      },
      {
        id: 'clickup:t1:c1',
        source: 'clickup',
        clickupTaskId: 't1',
        kind: 'answer',
        channelName: 'ClickUp · DEV-12345',
        author: 'Женя',
        permalink: 'https://app.clickup.com/t/t1',
        quote: 'Когда выкатываем?',
        ask: 'Когда выкатываем автоответ?',
        title: 'Саманта: автоответ',
        description: '',
        project: null,
        foundAt: new Date(NOW).toISOString()
      }
    ],
    done: [
      {
        id: 'C1:2.2',
        decision: 'rejected',
        at: NOW - 600_000,
        title: 'Старый вопрос',
        author: 'Laure'
      }
    ]
  },
  'hqProjects.runRequestOnDesktop': { ok: true },
  'hqProjects.runBellActionOnDesktop': { ok: true },
  'pulse.snapshot': {
    people: [{ id: 'p1', name: 'Женя' }],
    waitings: [
      {
        id: 'w1',
        direction: 'on-them',
        title: 'Выгрузка возвратов',
        personId: 'p1',
        project: null,
        dueAt: null,
        createdAt: NOW,
        source: 'manual'
      },
      {
        id: 'w2',
        direction: 'on-me',
        title: 'Купить домен',
        personId: null,
        project: null,
        dueAt: null,
        createdAt: NOW,
        source: 'note'
      }
    ],
    decisions: []
  },
  'pulse.upsertPerson': { id: 'p2', name: 'Ирина' },
  'pulse.addWaiting': { id: 'w3' },
  'pulse.closeWaiting': { id: 'w1' },
  'pulse.listInbox': [
    {
      id: 'i1',
      kind: 'agent-finished',
      title: 'Claude finished DEV-12345',
      body: 'Samantha · tests green',
      urgency: 'normal',
      refKind: null,
      refId: null,
      actions: [{ id: 'open', label: 'Open' }],
      dedupeKey: null,
      createdAt: NOW,
      readAt: null,
      doneAt: null,
      doneAction: null
    },
    {
      id: 'i2',
      kind: 'outgoing-approval',
      title: 'Approve an outgoing action',
      body: 'Slack · send message',
      urgency: 'high',
      refKind: 'draft',
      refId: 'd1',
      actions: [{ id: 'approve', label: 'Approve' }],
      dedupeKey: null,
      createdAt: NOW - 60_000,
      readAt: null,
      doneAt: null,
      doneAction: null
    }
  ],
  'pulse.markInboxRead': { id: 'i1' },
  'hqProjects.rejectSlackDraft': { ok: true },
  'hqProjects.draftClickUpReply': { ok: true, text: 'Сегодня вечером.' },
  'hqProjects.sendClickUpReply': { ok: true }
}

const bundles = mobileWebAppDependenciesPresent()
const describeRender = bundles ? describe : describe.skip

let scratch
let server
let browser
let origin
let cspHeader = null
let bridgeVersion = null
let faultGrant = null

beforeAll(async () => {
  if (!bundles) {
    return
  }
  cspHeader = await readShellCsp()
  bridgeVersion = await readBridgeProtocolVersion()
  faultGrant = await readBridgeFaultGrant()
  scratch = await mkdtemp(join(tmpdir(), 'orca-mobile-web-app-hq-'))
  const built = await buildMobileWebAppBundle({ outDir: join(scratch, 'bundle') })
  const served = await createBundleServer({ outDir: built.outDir, cspHeader })
  server = served.server
  origin = served.origin
  const executablePath = process.env.ORCA_MOBILE_WEB_RENDER_BROWSER
  browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) })
}, 180_000)

afterAll(async () => {
  await browser?.close()
  server?.close()
  if (scratch) {
    await rm(scratch, { recursive: true, force: true })
  }
})

async function openHq(pathname = HQ_ROUTE, ready = 'done for you') {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
  await page.addInitScript(installShellDouble, {
    version: bridgeVersion,
    sessionId: 'render-check-session',
    buildId: 'render-check-build',
    route: { pathname },
    host: SHELL_HOST,
    storage: {},
    faultGrant,
    grants: [faultGrant, ...HQ_GRANTS],
    pageRoutes: PAGE_ROUTE_PATTERNS,
    replies: REPLIES
  })
  const errors = []
  page.on('pageerror', (error) => errors.push(`${error.name}: ${error.message}`))
  page.on('console', (message) => {
    if (message.type() === 'error') {
      errors.push(`console.error: ${message.text()}`)
    }
  })
  await page.goto(`${origin}/`, { waitUntil: 'load' })
  await page.waitForFunction(
    (text) => document.body.innerText.toLowerCase().includes(text),
    ready,
    {
      timeout: 30_000,
      polling: 250
    }
  )
  return { page, errors }
}

async function shot(page, name) {
  const path = process.env.ORCA_MOBILE_WEB_RENDER_SHOT
  if (path) {
    await page.screenshot({ path: path.replace(/\.png$/, `${name}.png`), fullPage: true })
  }
}

const sent = (page, method) =>
  page.evaluate(
    (name) => globalThis.__orcaRenderCheckRequests.filter((request) => request.method === name),
    method
  )

describeRender('the HQ route in a real browser', () => {
  it('opens HQ from the worktree list header without leaving the document', async () => {
    const { page, errors } = await openHq(HOST_ROUTE, SHELL_HOST.name.toLowerCase())
    await shot(page, '-host')
    await page.getByRole('button', { name: 'HQ' }).click()
    await page.waitForFunction(() => document.body.innerText.toLowerCase().includes('done for you'))
    expect(await page.evaluate(() => location.pathname)).toBe(HQ_ROUTE)
    expect(errors).toEqual([])
    await page.close()
  }, 60_000)

  it('paints the requests to the owner and what was done for him', async () => {
    const { page, errors } = await openHq()
    const text = await page.evaluate(() => document.body.innerText)
    // Section titles are upper-cased by style, which innerText reflects.
    expect(text.toLowerCase()).toContain('needs you · 2')
    expect(text).toContain('Ирина: Проверь тикеты по возвратам')
    expect(text).toContain('Женя: Когда выкатываем автоответ?')
    expect(text).toContain('Skipped')
    expect(text).toContain('Bring back')
    expect(text).not.toContain('Unmatched Route')
    await shot(page, '')
    expect(errors).toEqual([])
    await page.close()
  }, 60_000)

  it('hands Do on a Slack request to the Mac, and says it started there', async () => {
    const { page } = await openHq()
    await page.getByRole('button', { name: 'Do' }).first().click()
    await page.waitForFunction(() => document.body.innerText.includes('Started on your Mac'))
    expect(await sent(page, 'hqProjects.runRequestOnDesktop')).toEqual([
      { method: 'hqProjects.runRequestOnDesktop', params: { id: 'D1:1.1', action: 'do' } }
    ])
    await page.close()
  }, 60_000)

  it('drafts a ClickUp reply on the phone and sends the edited text with the draft', async () => {
    const { page } = await openHq()
    await page.getByRole('button', { name: 'Just reply' }).nth(1).click()
    const box = page.getByLabel('Reply in ClickUp')
    await page.waitForFunction(
      () => document.querySelector('textarea')?.value === 'Сегодня вечером.'
    )
    await box.fill('Сегодня')
    await page.getByRole('button', { name: 'Send' }).click()
    await page.waitForFunction(() => document.body.innerText.includes('Reply posted in ClickUp.'))
    expect(await sent(page, 'hqProjects.sendClickUpReply')).toEqual([
      {
        method: 'hqProjects.sendClickUpReply',
        params: { id: 'clickup:t1:c1', text: 'Сегодня', draft: 'Сегодня вечером.' }
      }
    ])
    expect(await sent(page, 'hqProjects.runRequestOnDesktop')).toEqual([])
    await page.close()
  }, 60_000)

  it('jots a note for a person in one line, the way the Mac reads it', async () => {
    const { page, errors } = await openHq()
    await page.getByRole('tab', { name: 'Notes' }).click()
    await page.waitForFunction(() => document.body.innerText.includes('Выгрузка возвратов'))
    const text = await page.evaluate(() => document.body.innerText.toLowerCase())
    expect(text).toContain("i'm waiting on · 1")
    expect(text).toContain('just notes · 1')
    await page.getByLabel('New note').fill('@Ирина жду выгрузку')
    await page.waitForFunction(() => document.body.innerText.includes('waiting on Ирина'))
    await shot(page, '-notes')
    await page.getByRole('button', { name: 'Add' }).click()
    await page.waitForFunction(() =>
      globalThis.__orcaRenderCheckRequests.some((r) => r.method === 'pulse.addWaiting')
    )
    expect(await sent(page, 'pulse.upsertPerson')).toEqual([
      { method: 'pulse.upsertPerson', params: { name: 'Ирина' } }
    ])
    expect((await sent(page, 'pulse.addWaiting'))[0]?.params).toMatchObject({
      direction: 'on-them',
      personId: 'p2',
      source: 'manual'
    })
    expect(errors).toEqual([])
    await page.close()
  }, 60_000)

  it("runs a bell item's button on the Mac, and offers none on an approval", async () => {
    const { page } = await openHq()
    await page.getByRole('tab', { name: 'Inbox' }).click()
    await page.waitForFunction(() => document.body.innerText.includes('Claude finished DEV-12345'))
    const text = await page.evaluate(() => document.body.innerText)
    expect(text).toContain('Approve this on your Mac.')
    await shot(page, '-inbox')
    expect(await page.getByRole('button', { name: 'Approve' }).count()).toBe(0)
    await page.getByRole('button', { name: 'Open' }).click()
    await page.waitForFunction(() => document.body.innerText.includes('ran on your Mac'))
    expect(await sent(page, 'hqProjects.runBellActionOnDesktop')).toEqual([
      {
        method: 'hqProjects.runBellActionOnDesktop',
        params: { itemId: 'i1', actionId: 'open' }
      }
    ])
    await page.close()
  }, 60_000)
})

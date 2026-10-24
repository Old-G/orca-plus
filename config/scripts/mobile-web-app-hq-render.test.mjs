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
 * Custom build (hq-mobile): HQ's page route in a real browser. Custom build (hq-plus-phone): the route
 * is HQ+ now — the feed painted from the Mac's replies by the desktop's rules, the drawer, the link
 * sheet, and the verbs each button sends; an approval shows its text and offers no way to send it.
 * `ORCA_MOBILE_WEB_RENDER_SHOT` saves a screenshot of each state for a visual check.
 */

const HOST_ROUTE = '/h/render-check-host'
const HQ_ROUTE = `${HOST_ROUTE}/hq`
const PAGE_ROUTE_PATTERNS = ['/h/[hostId]', '/h/[hostId]/hq']
const HQ_GRANTS = [
  'navigate',
  'storage',
  'externalLink',
  'haptics',
  'native.clipboard.write',
  'native.audio.start',
  'native.audio.read',
  'native.audio.stop'
]
const SHELL_HOST = {
  id: 'render-check-host',
  name: 'Render Check Host',
  endpoint: 'ws://render-check',
  lastConnected: 1
}

const NOW = Date.now()
const entry = (fields) => ({
  workspace: 'acme',
  project: 'acme-app',
  address: null,
  sessionId: null,
  personId: null,
  body: null,
  needs: 'nobody',
  status: 'done',
  replyTo: null,
  refKind: null,
  refId: null,
  links: [],
  source: 'hq-plus',
  dedupeKey: null,
  ...fields
})
const bell = (fields) => ({
  urgency: 'normal',
  refKind: null,
  refId: null,
  dedupeKey: null,
  readAt: null,
  doneAt: null,
  doneAction: null,
  ...fields
})
const REPLIES = {
  'hq.feed': {
    now: NOW,
    sessions: [],
    entries: [
      entry({
        id: 'e-chat',
        at: NOW - 30 * 60_000,
        kind: 'chat.report',
        sessionId: 's-chat',
        title: 'Release notes drafted',
        body: 'Release notes drafted and checked against the changelog.'
      }),
      entry({
        id: 'e-move',
        at: NOW - 20 * 60_000,
        kind: 'chat.report',
        address: 'acme-app/billing',
        sessionId: 's-move',
        needs: 'owner:decide',
        status: 'open',
        title: 'Billing: which plan first?',
        body: 'Which plan goes first?\n- **(a) Monthly**\n- **(b) Yearly**'
      }),
      entry({
        id: 'e-approve',
        at: NOW - 10 * 60_000,
        kind: 'approve.request',
        needs: 'owner:approve',
        status: 'open',
        refKind: 'draft',
        refId: 'd1',
        title: 'Approve: Slack · #general',
        body: 'Ann, the billing page ships today.'
      })
    ],
    inbox: [
      bell({
        id: 'i-approve',
        kind: 'outgoing-approval',
        title: 'Approve an outgoing action',
        body: 'Slack · send message',
        urgency: 'high',
        refKind: 'draft',
        refId: 'd1',
        actions: [{ id: 'approve', label: 'Approve' }],
        createdAt: NOW - 10 * 60_000
      }),
      bell({
        id: 'i-reply',
        kind: 'hq-waiting-reply',
        title: 'Bob answered: access to the dashboard',
        body: 'Bob: yes, the same keys work, access by tonight.',
        refId: JSON.stringify({
          waitingId: 'w1',
          author: 'Bob',
          project: 'acme-app',
          link: 'https://acme.slack.com/archives/C1/p1'
        }),
        actions: [
          { id: 'reply-deliver', label: 'Pass to chat' },
          { id: 'reply-open', label: 'Open' },
          { id: 'reply-skip', label: 'Skip' }
        ],
        createdAt: NOW - 5 * 60_000
      })
    ]
  },
  'hqProjects.spaces': {
    ok: true,
    spaces: [
      {
        slug: 'personal',
        name: 'Personal',
        color: '#22c55e',
        repoIds: [],
        projects: ['notes'],
        isDefault: true
      },
      { slug: 'acme', name: 'Acme', color: '#3b82f6', repoIds: ['r1'], projects: ['acme-app'] }
    ]
  },
  'hqProjects.chatList': {
    publishedAt: NOW,
    items: [
      {
        key: 'wt1\u0000structured-agent-session-s-chat',
        group: 'working',
        worktreeId: 'wt1',
        paneKey: 'pane-chat',
        executionHostId: null,
        projectName: 'acme-app',
        worktreeName: 'main',
        title: 'Release notes',
        preview: 'Drafting the release notes',
        agentType: 'claude',
        unseen: false,
        sortAt: NOW - 60_000,
        color: '#4a2e54',
        repoId: 'r1'
      }
    ]
  },
  'pulse.snapshot': {
    people: [{ id: 'p1', name: 'Bob' }],
    waitings: [
      {
        id: 'w1',
        direction: 'on-them',
        title: 'Dashboard access',
        personId: 'p1',
        project: 'acme-app',
        dueAt: null,
        createdAt: NOW - 2 * 24 * 60 * 60_000,
        source: 'manual'
      }
    ],
    decisions: []
  },
  'settings.get': { settings: { hqPath: '/Users/me/HQ' } },
  'chat.send': { delivered: true },
  'pulse.markInboxDone': { id: 'i-reply' },
  'hqProjects.runBellActionOnDesktop': { ok: true },
  'hqProjects.askHqOnDesktop': { ok: true },
  'hqProjects.settings': { hqVoicePromptsEnabled: false }
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
  scratch = await mkdtemp(join(tmpdir(), 'orca-mobile-web-app-hq-plus-'))
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

async function openHq(
  pathname = HQ_ROUTE,
  ready = 'today',
  replies = REPLIES,
  safeAreaInsets = null
) {
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
    replies,
    ...(safeAreaInsets === null ? {} : { safeAreaInsets })
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

describeRender('HQ+ on the phone in a real browser', () => {
  it('opens HQ+ from the worktree list header without leaving the document', async () => {
    const { page, errors } = await openHq(HOST_ROUTE, SHELL_HOST.name.toLowerCase())
    await page.getByRole('button', { name: 'HQ+' }).click()
    await page.waitForFunction(() => document.body.innerText.includes('TODAY'))
    expect(await page.evaluate(() => location.pathname)).toBe(HQ_ROUTE)
    expect(errors).toEqual([])
    await page.close()
  }, 60_000)

  it('paints the feed by the desktop rules, with the approval read only', async () => {
    const { page, errors } = await openHq()
    await page.waitForFunction(() => document.body.innerText.includes('Approve on Mac'))
    const text = await page.evaluate(() => document.body.innerText)
    expect(text).toContain('Release notes drafted')
    expect(text).toContain('Which plan goes first?')
    expect(text).toContain('Ann, the billing page ships today.')
    expect(text).toContain('YOUR MOVE')
    expect(text).toContain('Send answer to chat')
    expect(text).toContain('→ All')
    for (const room of ['All', 'Personal', 'Acme']) {
      expect(await page.getByRole('button', { name: room, exact: true }).count()).toBe(1)
    }
    expect(await page.getByRole('button', { name: /^Approve/ }).count()).toBe(0)
    expect(await page.getByRole('button', { name: 'Reject' }).count()).toBe(0)
    await shot(page, '')
    expect(errors).toEqual([])
    await page.close()
  }, 60_000)

  it("answers the agent's question into its thread, as the desktop card does", async () => {
    const { page } = await openHq()
    await page.getByRole('button', { name: '(a) Monthly' }).click()
    await page.waitForFunction(() =>
      globalThis.__orcaRenderCheckRequests.some((r) => r.method === 'chat.send')
    )
    expect(await sent(page, 'chat.send')).toEqual([
      {
        method: 'chat.send',
        params: {
          address: 'acme-app/billing',
          text: '(a) Monthly',
          replyTo: 'e-move',
          callerCwd: '/Users/me/HQ'
        }
      }
    ])
    await page.close()
  }, 60_000)

  it("passes a person's answer on in the Mac's window", async () => {
    const { page } = await openHq()
    await page.getByRole('button', { name: 'Send answer to chat' }).click()
    await page.waitForFunction(() =>
      globalThis.__orcaRenderCheckRequests.some(
        (r) => r.method === 'hqProjects.runBellActionOnDesktop'
      )
    )
    expect(await sent(page, 'hqProjects.runBellActionOnDesktop')).toEqual([
      {
        method: 'hqProjects.runBellActionOnDesktop',
        params: { itemId: 'i-reply', actionId: 'reply-deliver' }
      }
    ])
    await page.close()
  }, 60_000)

  it('keeps the rest in the drawer and flashes a picked card in the feed', async () => {
    const { page, errors } = await openHq()
    await page.getByRole('button', { name: 'Menu: waiting on you, chats, views' }).click()
    await page.waitForFunction(() => /WAITING ON YOU · 3/i.test(document.body.innerText))
    // Why: the waits are read once the drawer opens.
    await page.waitForFunction(() => document.body.innerText.includes('Bob · Dashboard access'))
    const text = await page.evaluate(() => document.body.innerText)
    expect(text).toMatch(/WE WAIT · 1/i)
    expect(text).toContain('Bob · Dashboard access')
    expect(text).toContain('Release notes')
    await shot(page, '-drawer')
    await page.getByRole('button', { name: 'Which plan goes first?' }).click()
    const drawer = page.getByTestId('hq-plus-drawer')
    await page.waitForTimeout(400)
    expect((await drawer.boundingBox())?.x ?? 0).toBeLessThan(0)
    expect(errors).toEqual([])
    await page.close()
  }, 60_000)

  it('asks where a link opens: Orca browser, Safari or copied', async () => {
    const { page } = await openHq()
    await page.getByRole('link', { name: 'Slack ↗' }).click()
    const sheet = page.getByTestId('hq-plus-link-sheet')
    await page.waitForTimeout(400)
    const text = await sheet.innerText()
    expect(text).toContain('https://acme.slack.com/archives/C1/p1')
    expect(text).toContain('Orca Browser')
    expect(text).toContain('Safari')
    expect(text).toContain('Copy link')
    await shot(page, '-link')
    await page.close()
  }, 60_000)

  it('sends «Write to HQ» to the Ask HQ chat on the Mac', async () => {
    const { page } = await openHq()
    await page.getByLabel('Write to HQ').fill('What did we decide about billing?')
    await page.getByRole('button', { name: 'Send' }).last().click()
    await page.waitForFunction(() => document.body.innerText.includes('Sent to Ask HQ on the Mac'))
    expect(await sent(page, 'hqProjects.askHqOnDesktop')).toEqual([
      {
        method: 'hqProjects.askHqOnDesktop',
        params: { text: 'What did we decide about billing?' }
      }
    ])
    await page.close()
  }, 60_000)
})

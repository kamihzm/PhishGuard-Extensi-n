import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  chromium,
  expect,
  test as base,
  type BrowserContext,
  type Page,
  type Worker,
} from '@playwright/test'
import { hostResolverRules, startFixtureServer, type FixtureServer } from './server'

/** Unpacked extension produced by `npm run build` (must be a fresh build of HEAD). */
export const EXTENSION_DIST = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'dist')

export interface ExtensionHarness {
  context: BrowserContext
  extensionId: string
  /** Current extension service worker; waits for a new one if the previous was stopped. */
  getSw(): Promise<Worker>
  /**
   * Stops the extension service worker with CDP `ServiceWorker.stopWorker`
   * (page-level session on `via`) and waits until CDP reports the version
   * `stopped`. Returns the observed running-status transitions.
   */
  stopSw(via: Page): Promise<string[]>
  /** Running-status transitions of the extension worker seen since `stopSw`. */
  swStatusLog(): string[]
  /** Tab id of `page` as seen by the extension (via `chrome.tabs.query`). */
  tabIdOf(page: Page): Promise<number>
}

type WorkerFixtures = { server: FixtureServer }
type TestFixtures = { ext: ExtensionHarness; publisher: Page }

const isExtensionWorker = (w: Worker) => w.url().startsWith('chrome-extension://')

async function launchExtensionContext(): Promise<{ context: BrowserContext; userDataDir: string }> {
  const userDataDir = mkdtempSync(join(tmpdir(), 'phishguard-e2e-'))
  const context = await chromium.launchPersistentContext(userDataDir, {
    // Official docs: extensions load in headless mode with the `chromium` channel.
    // https://playwright.dev/docs/chrome-extensions
    channel: 'chromium',
    headless: true,
    args: [
      `--disable-extensions-except=${EXTENSION_DIST}`,
      `--load-extension=${EXTENSION_DIST}`,
      `--host-resolver-rules=${hostResolverRules()}`,
    ],
  })
  return { context, userDataDir }
}

function createHarness(context: BrowserContext, extensionId: string): ExtensionHarness {
  let statusLog: string[] = []
  const getSw = async () => {
    const live = context.serviceWorkers().find(isExtensionWorker)
    if (live) return live
    return context.waitForEvent('serviceworker', { predicate: isExtensionWorker, timeout: 10_000 })
  }
  return {
    context,
    extensionId,
    getSw,
    async stopSw(via: Page) {
      const session = await context.newCDPSession(via)
      const status = new Map<string, string>()
      session.on('ServiceWorker.workerVersionUpdated', (event) => {
        for (const v of event.versions) {
          if (!v.scriptURL.startsWith(`chrome-extension://${extensionId}/`)) continue
          status.set(v.versionId, v.runningStatus)
          statusLog.push(v.runningStatus)
        }
      })
      await session.send('ServiceWorker.enable')
      await expect.poll(() => [...status.values()], { timeout: 5_000 }).toContain('running')
      const versionId = [...status].find(([, s]) => s === 'running')![0]
      statusLog = ['running']
      await session.send('ServiceWorker.stopWorker', { versionId })
      await expect.poll(() => status.get(versionId), { timeout: 5_000 }).toBe('stopped')
      return [...statusLog]
    },
    swStatusLog: () => [...statusLog],
    async tabIdOf(page: Page) {
      const url = page.url()
      const sw = await getSw()
      const ids = await sw.evaluate(
        async (target) =>
          (await chrome.tabs.query({})).filter((t) => t.url === target).map((t) => t.id),
        url,
      )
      if (ids.length !== 1)
        throw new Error(`expected exactly one tab with ${url}, got ${ids.length}`)
      return ids[0]!
    },
  }
}

export const test = base.extend<TestFixtures, WorkerFixtures>({
  server: [
    async ({}, use) => {
      const server = await startFixtureServer()
      await use(server)
      await server.close()
    },
    { scope: 'worker' },
  ],
  // A fresh browser profile per test: the guard keeps in-memory per-tab state
  // (cooldowns, observations) that must not leak between scenarios.
  ext: async ({}, use) => {
    const { context, userDataDir } = await launchExtensionContext()
    try {
      const sw =
        context.serviceWorkers().find(isExtensionWorker) ??
        (await context.waitForEvent('serviceworker', { predicate: isExtensionWorker }))
      const extensionId = new URL(sw.url()).host
      // Web Protection must be enabled with its default ("Anuncios" on).
      await expect
        .poll(
          () =>
            sw.evaluate(async () => {
              const stored = await chrome.storage.local.get('phishguard:webProtection')
              const value = stored['phishguard:webProtection'] as
                { adsEnabled?: boolean } | undefined
              return value?.adsEnabled ?? true
            }),
          { timeout: 5_000 },
        )
        .toBe(true)
      await use(createHarness(context, extensionId))
    } finally {
      await context.close()
      rmSync(userDataDir, { recursive: true, force: true, maxRetries: 3 })
    }
  },
  publisher: async ({ ext, server }, use) => {
    const page = await ext.context.newPage()
    await page.goto(server.url('publisher.test', '/'))
    await expect(page.locator('h1')).toHaveText('Publisher')
    await use(page)
  },
})

export { expect }

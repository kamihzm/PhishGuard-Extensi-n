import type { Page } from '@playwright/test'
import { expect, test, type ExtensionHarness } from './fixtures'
import {
  CLOSE_BOUND_MS,
  expectNoPhishingWarning,
  expectStaysOpen,
  openedBy,
  recordMainFrameUrls,
  STAYS_OPEN_WINDOW_MS,
} from './helpers'

/**
 * Redirect Guard in real Chromium: the user clicks a normal link to
 * legit.test, but the page's click handler hijacks the navigation to a listed
 * ad host (`location.href = 'http://popads.net/ad'`). Expected: the tab is
 * sent back once (`tabs.goBack`) to the publisher.
 *
 * `page.goto(publisher)` in the `publisher` fixture is the prior committed
 * navigation the guard needs (`state.lastUrl`).
 */

const isHost = (url: string, host: string) => {
  try {
    return new URL(url).hostname === host
  } catch {
    return false
  }
}

async function hijackAndExpectRevert(
  publisher: Page,
  publisherUrl: string,
  selector = '#hijack',
): Promise<string[]> {
  const urls = recordMainFrameUrls(publisher)
  await publisher.locator(selector).click()
  await expect
    .poll(() => urls.some((u) => isHost(u, 'popads.net')), {
      timeout: CLOSE_BOUND_MS,
      message: 'the click handler should hijack the tab to popads.net',
    })
    .toBe(true)
  await expect
    .poll(() => publisher.url(), {
      timeout: CLOSE_BOUND_MS,
      message: `expected tabs.goBack to ${publisherUrl}; committed URLs: ${urls.join(' -> ')}`,
    })
    .toBe(publisherUrl)
  return urls
}

/** A requested navigation must commit and stay: no `goBack` during the decision window. */
async function followLinkAndExpectNoRevert(
  publisher: Page,
  expectedHost: string,
  selector = '#plain-link',
): Promise<void> {
  const urls = recordMainFrameUrls(publisher)
  await publisher.locator(selector).click()
  await expect
    .poll(() => urls.some((u) => isHost(u, expectedHost)), { timeout: CLOSE_BOUND_MS })
    .toBe(true)
  await publisher.waitForTimeout(STAYS_OPEN_WINDOW_MS)
  expect(
    isHost(publisher.url(), expectedHost),
    `expected to stay on ${expectedHost}; committed URLs: ${urls.join(' -> ')}`,
  ).toBe(true)
}

async function restartWorker(ext: ExtensionHarness, publisher: Page): Promise<void> {
  await markWorker(ext)
  expect(await ext.stopSw(publisher)).toContain('stopped')
}

/** Proof the scenario ran on a restarted worker (not a live one). */
async function expectRestarted(ext: ExtensionHarness): Promise<void> {
  expect(ext.swStatusLog()).toEqual(expect.arrayContaining(['stopped', 'running']))
  expect(await workerMarker(ext)).toBeUndefined()
}

/** Marks the current worker's global scope, so a restart is observable. */
async function markWorker(ext: ExtensionHarness) {
  const sw = await ext.getSw()
  await sw.evaluate(() => {
    ;(globalThis as { __e2eMarker?: number }).__e2eMarker = 1
  })
}

async function workerMarker(ext: ExtensionHarness) {
  const sw = await ext.getSw()
  return sw.evaluate(() => (globalThis as { __e2eMarker?: number }).__e2eMarker)
}

test.describe('Redirect Guard: click hijack with a live service worker', () => {
  test('click hijack to a listed ad host is reverted with goBack to the publisher', async ({
    publisher,
    server,
  }) => {
    await hijackAndExpectRevert(publisher, server.url('publisher.test', '/'))
    expectNoPhishingWarning(publisher)
  })

  test('click hijack through a 302 chain (hop.test -> popads.net) is reverted with goBack', async ({
    publisher,
    server,
  }) => {
    await hijackAndExpectRevert(publisher, server.url('publisher.test', '/'), '#hijack-chain')
    expectNoPhishingWarning(publisher)
  })

  test('requested link to another site commits and is not reverted', async ({ publisher }) => {
    await followLinkAndExpectNoRevert(publisher, 'legit.test')
    expectNoPhishingWarning(publisher)
  })

  test('service worker stop is observable and a restart clears its global scope', async ({
    ext,
    publisher,
    server,
  }) => {
    await markWorker(ext)
    expect(await workerMarker(ext)).toBe(1)

    expect(await ext.stopSw(publisher)).toEqual(['running', 'stopping', 'stopped'])

    // Any extension event wakes it again: a navigation in another tab.
    const other = await ext.context.newPage()
    await other.goto(server.url('legit.test', '/wake'))
    await expect.poll(() => ext.swStatusLog().at(-1)).toBe('running')
    expect(await workerMarker(ext)).toBeUndefined()
  })
})

test.describe('Redirect Guard: P1 regressions (failed before the fix)', () => {
  test('P1: click hijack right after a service-worker restart is reverted with goBack', async ({
    ext,
    publisher,
    server,
  }) => {
    await restartWorker(ext, publisher)

    // The hijacking click itself wakes the worker (webNavigation event).
    let failure: unknown = null
    try {
      await hijackAndExpectRevert(publisher, server.url('publisher.test', '/'))
    } catch (error) {
      failure = error
    }
    await expectRestarted(ext)
    if (failure) throw failure
  })

  test('P1: click hijack through a 302 chain right after a service-worker restart is reverted', async ({
    ext,
    publisher,
    server,
  }) => {
    await restartWorker(ext, publisher)
    let failure: unknown = null
    try {
      await hijackAndExpectRevert(publisher, server.url('publisher.test', '/'), '#hijack-chain')
    } catch (error) {
      failure = error
    }
    await expectRestarted(ext)
    if (failure) throw failure
  })

  test('P1: click hijack after a restart, with the worker already woken by another tab, is reverted', async ({
    ext,
    publisher,
    server,
  }) => {
    await restartWorker(ext, publisher)
    // Another extension event wakes the worker first: in-memory lastUrl of the publisher tab is gone.
    const other = await ext.context.newPage()
    await other.goto(server.url('legit.test', '/wake'))
    await expectRestarted(ext)
    await publisher.bringToFront()
    await hijackAndExpectRevert(publisher, server.url('publisher.test', '/'))
    expectNoPhishingWarning(publisher)
  })

  test('P1 guard: requested link right after a service-worker restart is not reverted', async ({
    ext,
    publisher,
  }) => {
    await restartWorker(ext, publisher)
    await followLinkAndExpectNoRevert(publisher, 'legit.test')
    await expectRestarted(ext)
    expectNoPhishingWarning(publisher)
  })
})

/**
 * Requested navigations must never be reverted, with a live worker and right
 * after a cold start (the click itself wakes the worker). The affiliate link
 * points to a LISTED host (redirectingat.com): only the user's intent keeps it.
 */
for (const mode of ['live worker', 'cold start'] as const) {
  test.describe(`Redirect Guard: requested navigations are not reverted (${mode})`, () => {
    const prepare = async (ext: ExtensionHarness, publisher: Page) => {
      if (mode === 'cold start') await restartWorker(ext, publisher)
    }
    const verify = async (ext: ExtensionHarness) => {
      if (mode === 'cold start') await expectRestarted(ext)
    }

    test('plain link to another site', async ({ ext, publisher }) => {
      await prepare(ext, publisher)
      await followLinkAndExpectNoRevert(publisher, 'legit.test')
      await verify(ext)
    })

    test('affiliate link to a listed host clicked by the user', async ({ ext, publisher }) => {
      await prepare(ext, publisher)
      await followLinkAndExpectNoRevert(publisher, 'redirectingat.com', '#aff-direct')
      await verify(ext)
    })

    test('form submitted by the user to another site', async ({ ext, publisher }) => {
      await prepare(ext, publisher)
      await followLinkAndExpectNoRevert(publisher, 'legit.test', '#search-submit')
      expect(new URL(publisher.url()).pathname).toBe('/search')
      await verify(ext)
    })

    for (const [name, selector, modifiers] of [
      ['target=_blank link', '#blank-link', []],
      ['Ctrl+click on a link', '#ctrl-link', ['Control']],
      ['OAuth popup to /authorize', '#oauth', []],
    ] as const) {
      test(`${name}: new tab stays open and the source tab is untouched`, async ({
        ext,
        publisher,
        server,
      }) => {
        await prepare(ext, publisher)
        const opened = await openedBy(ext.context, () =>
          publisher.locator(selector).click({ modifiers: [...modifiers] }),
        )
        await expectStaysOpen(opened)
        expect(publisher.url()).toBe(server.url('publisher.test', '/'))
        expectNoPhishingWarning(opened)
        await verify(ext)
      })
    }
  })
}

/**
 * DOCUMENTED LIMITATION (fail-open by design, see odd/tasks/popup-redirect-guard-fixes.md):
 * when the page redirects itself with NO user interaction and that redirect is
 * what wakes a stopped worker, there is no persisted intent and the previous
 * page can no longer be recovered (`tabs.get` is too late). The guard does not
 * guess, so the tab is NOT reverted: Redirect Guard does not protect this case.
 * Persisting every page URL to cover it would contradict data minimisation.
 */
test.describe('Redirect Guard: documented limitation (no user interaction, cold start)', () => {
  test('automatic redirect to a listed host after a cold start with no interaction is NOT reverted (fail-open)', async ({
    ext,
    publisher,
  }) => {
    // The user opens a countdown page (a requested navigation, worker alive).
    await publisher.locator('#auto-redirect').click()
    await expect.poll(() => isHost(publisher.url(), 'hop.test')).toBe(true)
    // The worker stops; 3 s later the page redirects by itself (no interaction).
    await restartWorker(ext, publisher)
    const urls = recordMainFrameUrls(publisher)
    await expect
      .poll(() => urls.some((u) => isHost(u, 'popads.net')), { timeout: 8_000 })
      .toBe(true)
    // Unprotected by design: the ad page stays (no goBack during the decision window).
    await publisher.waitForTimeout(STAYS_OPEN_WINDOW_MS)
    expect(
      isHost(publisher.url(), 'popads.net'),
      `documented fail-open behavior changed; committed URLs: ${urls.join(' -> ')}`,
    ).toBe(true)
    await expectRestarted(ext)
  })
})

test.describe('Redirect Guard: P1 design evidence', () => {
  test('records chrome.tabs.get url/pendingUrl at onBeforeNavigate of the hijack after a restart', async ({
    ext,
    publisher,
    server,
  }) => {
    await markWorker(ext)
    await ext.stopSw(publisher)
    const other = await ext.context.newPage()
    await other.goto(server.url('legit.test', '/wake'))
    expect(await workerMarker(ext)).toBeUndefined()

    // Test-only, read-only listener inside the restarted worker.
    const sw = await ext.getSw()
    await sw.evaluate(() => {
      type Probe = Record<string, unknown>
      const probes: Probe[] = []
      ;(globalThis as { __e2eProbe?: Probe[] }).__e2eProbe = probes
      const snapshot = async (
        event: string,
        d: { tabId: number; frameId: number; url: string },
      ) => {
        if (d.frameId !== 0) return
        const tab = await chrome.tabs.get(d.tabId).catch(() => null)
        probes.push({
          event,
          eventUrl: d.url,
          tabUrl: tab?.url ?? null,
          tabPendingUrl: tab?.pendingUrl ?? null,
          tabStatus: tab?.status ?? null,
        })
      }
      chrome.webNavigation.onBeforeNavigate.addListener((d) => void snapshot('onBeforeNavigate', d))
      chrome.webNavigation.onCommitted.addListener((d) => void snapshot('onCommitted', d))
    })

    const urls = recordMainFrameUrls(publisher)
    await publisher.locator('#hijack').click()
    await expect.poll(() => urls.some((u) => isHost(u, 'popads.net'))).toBe(true)

    const probes = await expect
      .poll(
        () =>
          sw.evaluate(
            () => (globalThis as { __e2eProbe?: Array<Record<string, unknown>> }).__e2eProbe ?? [],
          ),
        { timeout: CLOSE_BOUND_MS },
      )
      .toEqual(expect.arrayContaining([expect.objectContaining({ event: 'onBeforeNavigate' })]))
      .then(() => sw.evaluate(() => (globalThis as { __e2eProbe?: unknown[] }).__e2eProbe ?? []))
    const report = JSON.stringify(probes, null, 2).replaceAll(`:${server.port}`, ':PORT')
    test.info().annotations.push({ type: 'p1-tabs-get-evidence', description: report })
    console.log(`[P1 evidence] ${report}`)
  })

  test('records chrome.tabs.get through a 302 chain and around a navigation that ends in an error', async ({
    ext,
    publisher,
    server,
  }) => {
    await restartWorker(ext, publisher)
    const other = await ext.context.newPage()
    await other.goto(server.url('legit.test', '/wake'))
    await expectRestarted(ext)
    const tabId = await ext.tabIdOf(publisher)

    // Test-only, read-only listeners inside the restarted worker, scoped to the publisher tab.
    const sw = await ext.getSw()
    await sw.evaluate((watchedTab) => {
      type Probe = Record<string, unknown>
      const probes: Probe[] = []
      ;(globalThis as { __e2eChainProbe?: Probe[] }).__e2eChainProbe = probes
      const snapshot = async (event: string, tabId: number, eventUrl: string) => {
        if (tabId !== watchedTab) return
        const tab = await chrome.tabs.get(tabId).catch(() => null)
        probes.push({
          event,
          eventUrl,
          tabUrl: tab?.url ?? null,
          tabPendingUrl: tab?.pendingUrl ?? null,
          tabStatus: tab?.status ?? null,
        })
      }
      chrome.webNavigation.onBeforeNavigate.addListener((d) => {
        if (d.frameId === 0) void snapshot('onBeforeNavigate', d.tabId, d.url)
      })
      chrome.webNavigation.onCommitted.addListener((d) => {
        if (d.frameId === 0) void snapshot(`onCommitted(${d.transitionType})`, d.tabId, d.url)
      })
      chrome.webNavigation.onErrorOccurred.addListener((d) => {
        if (d.frameId === 0) void snapshot(`onErrorOccurred(${d.error})`, d.tabId, d.url)
      })
      chrome.webRequest.onBeforeRedirect.addListener(
        (d) => void snapshot('webRequest.onBeforeRedirect', d.tabId, d.redirectUrl),
        { urls: ['http://*/*'], types: ['main_frame'] },
      )
    }, tabId)
    const readProbes = () =>
      sw.evaluate(
        () =>
          (globalThis as { __e2eChainProbe?: Array<Record<string, unknown>> }).__e2eChainProbe ??
          [],
      )

    // 1) Hijack through a server 302 chain: publisher -> hop.test/out -> popads.net/chain.
    const urls = recordMainFrameUrls(publisher)
    await publisher.locator('#hijack-chain').click()
    await expect.poll(() => urls.some((u) => isHost(u, 'popads.net'))).toBe(true)
    await expect
      .poll(async () => (await readProbes()).some((p) => String(p.event).startsWith('onCommitted')))
      .toBe(true)

    // The worker was already awake, so the guard reverts this hijack (P1 fallback): wait for it.
    await expect
      .poll(() => publisher.url(), { timeout: CLOSE_BOUND_MS })
      .toBe(server.url('publisher.test', '/'))

    // 2) A navigation that ends in an error, then a navigation away from the error page.
    await publisher.locator('#broken-link').click()
    await expect
      .poll(async () =>
        (await readProbes()).some((p) => String(p.event).startsWith('onErrorOccurred')),
      )
      .toBe(true)
    const afterError = await sw.evaluate(async (id) => {
      const tab = await chrome.tabs.get(id)
      return { tabUrl: tab.url ?? null, tabPendingUrl: tab.pendingUrl ?? null, tabStatus: tab.status }
    }, tabId)
    await publisher.goto(server.url('legit.test', '/after-error'))

    const report = JSON.stringify({ probes: await readProbes(), afterError }, null, 2).replaceAll(
      `:${server.port}`,
      ':PORT',
    )
    test.info().annotations.push({ type: 'p1-chain-error-evidence', description: report })
    console.log(`[P1 chain/error evidence] ${report}`)
  })
})

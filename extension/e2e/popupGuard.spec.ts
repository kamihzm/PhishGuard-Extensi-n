import { expect, test } from './fixtures'
import { expectClosedWithin, expectNoPhishingWarning, expectStaysOpen, openedBy } from './helpers'

/**
 * Popup Guard in real Chromium: windows opened by a page
 * (`webNavigation.onCreatedNavigationTarget`). Every click is a real trusted
 * click, so the content-script intent recorder sees it.
 */

/** OBSERVATION_TTL_MS in popupState.ts: an observation older than this is "old state". */
const OBSERVATION_TTL_MS = 10_000

test.describe('Popup Guard: confirmed popup ads', () => {
  test('unrequested cross-site popup to a listed ad host is closed and the opener stays open', async ({
    ext,
    publisher,
  }) => {
    const openPages = () => ext.context.pages().filter((p) => !p.isClosed()).length
    const before = openPages()
    const popup = await openedBy(ext.context, () => publisher.locator('#popup-ad').click())

    await expectClosedWithin(popup)
    expect(publisher.isClosed()).toBe(false)
    expect(new URL(publisher.url()).hostname).toBe('publisher.test')
    expect(openPages()).toBe(before)
  })

  test('popup whose own redirect chain reaches a listed host while still observed is closed', async ({
    ext,
    publisher,
  }) => {
    // hop.test has no list evidence (POPUP_PENDING); 300 ms later it navigates
    // itself to redirectingat.com, well inside POPUP_PENDING_TTL_MS.
    const popup = await openedBy(ext.context, () => publisher.locator('#popup-fresh-hop').click())

    await expectClosedWithin(popup)
    expect(publisher.isClosed()).toBe(false)
  })
})

test.describe('Popup Guard: legitimate new tabs and windows stay open', () => {
  test('target=_blank link to another site stays open', async ({ ext, publisher }) => {
    const tab = await openedBy(ext.context, () => publisher.locator('#blank-link').click())

    await expectStaysOpen(tab)
    expect(new URL(tab.url()).hostname).toBe('legit.test')
    expectNoPhishingWarning(tab)
  })

  test('OAuth popup to an /authorize endpoint opened after a click stays open', async ({
    ext,
    publisher,
  }) => {
    const popup = await openedBy(ext.context, () => publisher.locator('#oauth').click())

    await expectStaysOpen(popup)
    expect(new URL(popup.url()).pathname).toBe('/authorize')
    expectNoPhishingWarning(popup)
  })

  test('Ctrl+click on a link opens a background tab that stays open', async ({
    ext,
    publisher,
  }) => {
    const tab = await openedBy(ext.context, () =>
      publisher.locator('#ctrl-link').click({ modifiers: ['Control'] }),
    )

    await expectStaysOpen(tab)
    await expect.poll(() => tab.url()).toContain('legit.test')
    expectNoPhishingWarning(tab)
  })

  test('PDF document opened in a new tab by a user click stays open', async ({
    ext,
    publisher,
  }) => {
    const tab = await openedBy(ext.context, () => publisher.locator('#pdf-link').click())

    await expectStaysOpen(tab)
    expectNoPhishingWarning(tab)
  })

  test('blob: document window opened by a user click stays open', async ({ ext, publisher }) => {
    const popup = await openedBy(ext.context, () => publisher.locator('#blob-doc').click())

    await expectStaysOpen(popup)
    expect(popup.url()).toMatch(/^blob:/)
  })
})

test.describe('Popup Guard: popunder windows (T6, technique not domains)', () => {
  // Every destination here is UNLISTED (hop.test, legit.test, idp.test,
  // publisher.test): no list evidence, so only the window technique can close.

  test('5x5 about:blank popup from a hidden iframe that then navigates cross-site is closed', async ({
    ext,
    publisher,
  }) => {
    // No onCreatedNavigationTarget for this window: only tabs.onCreated sees it.
    const popup = await openedBy(ext.context, () => publisher.locator('#player').click())

    await expectClosedWithin(popup)
    expect(publisher.isClosed()).toBe(false)
    expect(new URL(publisher.url()).hostname).toBe('publisher.test')
  })

  test('5x5 about:blank popup opened by the page itself that then navigates cross-site is closed', async ({
    ext,
    publisher,
  }) => {
    const popup = await openedBy(ext.context, () => publisher.locator('#player-top').click())

    await expectClosedWithin(popup)
    expect(publisher.isClosed()).toBe(false)
  })

  test('5x5 about:blank popup born at the opener edge after a click on a button (T7) is closed', async ({
    ext,
    publisher,
  }) => {
    // The click lands on a <button>: the intent carries control:true. The
    // opener window must fit the headless work area so the popup can really be
    // born at its right edge (measured: 600 px opener -> popup at left=570).
    const sw = await ext.getSw()
    const tabId = await ext.tabIdOf(publisher)
    await sw.evaluate(async (id) => {
      const tab = await chrome.tabs.get(id)
      await chrome.windows.update(tab.windowId, { left: 0, top: 0, width: 600, height: 500 })
    }, tabId)
    const popup = await openedBy(ext.context, () => publisher.locator('#play-button').click())

    await expectClosedWithin(popup)
    expect(publisher.isClosed()).toBe(false)
  })

  test('5x5 about:blank popup asked for at the screen edge by a button, opener filling the work area like a maximized window, is closed (T8)', async ({
    ext,
    publisher,
  }) => {
    // User's real Chrome: Chrome keeps the popup inside the screen, so it hugs
    // the opener's right edge instead of starting past it (headed run on a
    // 1536x864 screen: asked for left=1536, placed at left=1418, width 146).
    // Where Chrome places it depends on the display (headless: left=682), so a
    // probe popup is opened first and the opener is made to end where it ends,
    // like a maximized window. Headless margin observed: popup right edge 833
    // vs opener right edge 870 (37 px inside the 50 px band); on failure, the
    // `geometría popup=... opener=...` numbers of the T8 log show the gap.
    const sw = await ext.getSw()
    const tabId = await ext.tabIdOf(publisher)
    const probe = await openedBy(ext.context, () =>
      publisher.evaluate(() => {
        window.open('about:blank', 'probe', `popup=1,top=0,left=${screen.availWidth},width=5,height=5`)
      }),
    )
    const placed = await sw.evaluate(async () => {
      const w = (await chrome.windows.getAll()).find((x) => x.type === 'popup')
      return { left: w?.left ?? 0, width: w?.width ?? 0 }
    })
    await probe.close()
    const area = { left: 0, top: 0, width: placed.left + placed.width, height: 600 }
    await sw.evaluate(
      async ([id, bounds]) => {
        const tab = await chrome.tabs.get(id)
        await chrome.windows.update(tab.windowId, bounds)
        const logs: string[] = []
        ;(globalThis as { __e2eLogs?: string[] }).__e2eLogs = logs
        const original = console.log.bind(console)
        console.log = (...args: unknown[]) => {
          logs.push(args.map(String).join(' '))
          original(...args)
        }
      },
      [tabId, area] as const,
    )
    const popup = await openedBy(ext.context, () => publisher.locator('#play-full').click())

    await expectClosedWithin(popup)
    expect(publisher.isClosed()).toBe(false)
    const closing = await sw.evaluate(() =>
      ((globalThis as { __e2eLogs?: string[] }).__e2eLogs ?? []).find((m) =>
        m.includes('CONFIRMED_POPUP_AD → cerrando'),
      ),
    )
    test.info().annotations.push({ type: 'T8 geometry', description: String(closing) })
    expect(closing).toContain('popunder-window')
    expect(closing).toContain('fuente=windows.onCreated')
  })

  const staysOpen: Array<[string, string, string]> = [
    ['OAuth popup (516x735) opened empty, then sent to /authorize', '#oauth-blank', 'idp.test'],
    ['payment popup opened empty, then sent to /checkoutnow', '#pay-blank', 'legit.test'],
    ['player pop-out (180x140) opened straight to its page by a button', '#mini-player', 'legit.test'],
    ['chat window opened empty by a button, then sent to the chat site', '#chat-widget', 'legit.test'],
    ['small widget opened empty by a button, then sent to the same site', '#tiny-widget', 'publisher.test'],
    ['small chat window (180x140) opened empty by a button, then sent to another site', '#tiny-chat', 'legit.test'],
    ['window opened tiny that grows before navigating to another site', '#grow-then-go', 'legit.test'],
    ['window opened tiny by a button that grows before navigating to another site', '#grow-button', 'legit.test'],
    ['print window written in place that never navigates', '#print-window', ''],
    ['third-party login popup opened straight to its page', '#login-3p', 'idp.test'],
    ['large popup opened empty, then sent to another site', '#big-blank', 'legit.test'],
  ]
  test('tiny window opened empty by a button at the screen top-left corner, opener not maximized, then sent to another site stays open (T7)', async ({
    ext,
    publisher,
  }) => {
    // Born at the opener's left/top edge (isAtOpenerEdge true), never at its
    // right/bottom edge: the button's control veto must stay.
    const sw = await ext.getSw()
    const tabId = await ext.tabIdOf(publisher)
    await sw.evaluate(async (id) => {
      const tab = await chrome.tabs.get(id)
      await chrome.windows.update(tab.windowId, { left: 200, top: 150, width: 600, height: 450 })
    }, tabId)
    const popup = await openedBy(ext.context, () => publisher.locator('#corner-button').click())

    await expectStaysOpen(popup)
    expect(new URL(popup.url()).hostname).toBe('legit.test')
    expectNoPhishingWarning(popup)
  })

  test('small chat window opened empty by a third-party widget iframe, then sent to its site stays open', async ({
    ext,
    publisher,
  }) => {
    // The click happens inside the cross-site iframe: no intent is recorded there.
    const popup = await openedBy(ext.context, () =>
      publisher.frameLocator('#chat-frame').locator('#launch').click(),
    )

    await expectStaysOpen(popup)
    expect(new URL(popup.url()).hostname).toBe('legit.test')
    expectNoPhishingWarning(popup)
  })

  for (const [name, selector, host] of staysOpen) {
    test(`${name} stays open`, async ({ ext, publisher }) => {
      const popup = await openedBy(ext.context, () => publisher.locator(selector).click())

      await expectStaysOpen(popup)
      if (host) expect(new URL(popup.url()).hostname).toBe(host)
      else expect(popup.url()).toBe('about:blank')
      expectNoPhishingWarning(popup)
    })
  }
})

test.describe('Popup Guard: known defects (must fail before fix)', () => {
  test('P3: first-party redirector popup that 302s to a listed ad host is closed', async ({
    ext,
    publisher,
  }) => {
    // window.open('http://publisher.test/out?to=...') -> 302 -> popads.net/landing
    const popup = await openedBy(ext.context, () => publisher.locator('#popup-first-party').click())

    await expectClosedWithin(popup)
    expect(publisher.isClosed()).toBe(false)
  })

  test('P2: user click inside an old released popup to a listed host does not close it', async ({
    ext,
    publisher,
  }) => {
    test.setTimeout(60_000)
    // Unrequested cross-site popup without list evidence: POPUP_PENDING, then
    // released when its TTL expires; the tab stays.
    const popup = await openedBy(ext.context, () => publisher.locator('#popup-stale').click())
    const openedAt = Date.now()
    await expectStaysOpen(popup)
    expect(new URL(popup.url()).hostname).toBe('hop.test')

    // Real elapsed time is the scenario: the observation must be older than
    // OBSERVATION_TTL_MS (10 s) before the user acts inside the popup.
    const remaining = OBSERVATION_TTL_MS + 1_000 - (Date.now() - openedAt)
    if (remaining > 0) await popup.waitForTimeout(remaining)

    // The user, inside the popup, clicks a deal link to a listed host.
    await popup.locator('#aff-link').click()
    await expectStaysOpen(popup)
    await expect.poll(() => new URL(popup.url()).hostname).toBe('redirectingat.com')
  })
})

import type { BrowserContext, Page } from '@playwright/test'
import { expect } from '@playwright/test'

/**
 * Bound for "the guard closed the window". Production budget: intent query
 * (400 ms timeout) + evidence lookup + `tabs.remove`; 5 s leaves wide margin.
 */
export const CLOSE_BOUND_MS = 5_000
/**
 * Observation window for "the guard left the window alone": longer than
 * POPUP_PENDING_TTL_MS (2500 ms, popupState.ts) plus the 400 ms intent query,
 * so any decision the guard could take on the opening has already happened.
 */
export const STAYS_OPEN_WINDOW_MS = 4_000

/** Runs `action` and returns the page it opens (tab or window). */
export async function openedBy(
  context: BrowserContext,
  action: () => Promise<void>,
): Promise<Page> {
  const opened = context.waitForEvent('page', { timeout: CLOSE_BOUND_MS })
  await action()
  return opened
}

export async function expectClosedWithin(page: Page, ms = CLOSE_BOUND_MS): Promise<void> {
  await expect
    .poll(() => page.isClosed(), {
      timeout: ms,
      message: `expected the guard to close ${safeUrl(page)} within ${ms} ms`,
    })
    .toBe(true)
}

/**
 * Negative assertion: the page must still be open after the full decision
 * window. A real wait is required here, because "not closed" can only be
 * observed over time.
 */
export async function expectStaysOpen(page: Page, ms = STAYS_OPEN_WINDOW_MS): Promise<void> {
  const closedEarly = await Promise.race([
    new Promise<true>((resolve) => page.once('close', () => resolve(true))),
    new Promise<false>((resolve) => setTimeout(() => resolve(false), ms)),
  ])
  expect(
    closedEarly || page.isClosed(),
    `expected ${safeUrl(page)} to stay open for ${ms} ms, but it was closed`,
  ).toBe(false)
}

/** Main-frame URLs committed in `page`, in order (to observe a hijack and its revert). */
export function recordMainFrameUrls(page: Page): string[] {
  const urls: string[] = []
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) urls.push(frame.url())
  })
  return urls
}

/**
 * The phishing engine (navigationGate) may replace a tab with its warning
 * page. That is out of scope for these scenarios, so it is asserted
 * explicitly: if it happens, the failure names the interference instead of
 * looking like a guard decision.
 */
export function expectNoPhishingWarning(page: Page): void {
  if (page.isClosed()) return
  expect(page.url(), 'phishing engine interference: tab shows the warning page').not.toContain(
    'src/ui/warning/warning.html',
  )
}

const safeUrl = (page: Page) => {
  try {
    return page.url()
  } catch {
    return 'page'
  }
}

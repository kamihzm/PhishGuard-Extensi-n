import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { defineConfig } from '@playwright/test'

/**
 * Real-Chromium E2E suite for Web Protection's Popup Guard / Redirect Guard.
 * Each test launches its own persistent context with the unpacked build in
 * `dist/` (run `npm run build` first). Workers stay at 1: every test owns a
 * whole browser and several scenarios depend on real elapsed time.
 *
 * Artifacts (traces) go to the OS temp dir: inside a synced folder (OneDrive)
 * the sync client can lock trace files while the context closes (EBUSY).
 */
export default defineConfig({
  testDir: './e2e',
  outputDir: join(tmpdir(), 'phishguard-e2e-results'),
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 45_000,
  expect: { timeout: 5_000 },
  reporter: [['list']],
  use: { trace: 'retain-on-failure' },
})

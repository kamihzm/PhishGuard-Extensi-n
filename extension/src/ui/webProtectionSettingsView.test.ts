import { describe, expect, it, vi } from 'vitest'
import type { ReconcileSummary } from '../webProtection/runtime/reconcile'
import { renderWebProtectionSettings, webProtectionStatusText } from './webProtectionSettingsView'

function summary(overrides: Partial<ReconcileSummary> = {}): ReconcileSummary {
  return {
    reason: 'installed',
    outcome: 'applied',
    categories: ['ads', 'trackers'],
    activeRuleCount: 105_459,
    coreEnabled: ['wp-easylist-core', 'wp-easyprivacy-core'],
    coreFailed: [],
    optionalEnabled: 17,
    optionalSkippedForQuota: 0,
    optionalFailed: [],
    at: '2026-09-29T12:00:00.000Z',
    ...overrides,
  }
}

describe('renderWebProtectionSettings', () => {
  it('muestra un toggle independiente para anuncios y otro para rastreadores', () => {
    const container = document.createElement('div')
    renderWebProtectionSettings(
      container,
      { adsEnabled: true, trackersEnabled: false },
      null,
      () => {},
    )
    const toggles = [
      ...container.querySelectorAll<HTMLInputElement>('[data-web-protection-toggle]'),
    ]
    expect(toggles.map((t) => [t.dataset.webProtectionToggle, t.checked])).toEqual([
      ['adsEnabled', true],
      ['trackersEnabled', false],
    ])
    expect(container.textContent).toContain('PROTECCIÓN WEB')
  })

  it('cambiar un toggle notifica solo esa clave', () => {
    const container = document.createElement('div')
    const onToggle = vi.fn()
    renderWebProtectionSettings(
      container,
      { adsEnabled: true, trackersEnabled: true },
      null,
      onToggle,
    )
    const trackers = container.querySelector<HTMLInputElement>(
      '[data-web-protection-toggle="trackersEnabled"]',
    )!
    trackers.checked = false
    trackers.dispatchEvent(new Event('change'))
    expect(onToggle).toHaveBeenCalledWith('trackersEnabled', false)
  })
})

describe('webProtectionStatusText', () => {
  const both = { adsEnabled: true, trackersEnabled: true }
  it.each<[string, Parameters<typeof webProtectionStatusText>, RegExp]>([
    ['desactivada', [{ adsEnabled: false, trackersEnabled: false }, summary()], /desactivada/],
    ['aún sin estado', [both, null], /Aplicando/],
    ['activa completa', [both, summary()], /^Activa: 105.?459 reglas\.$/],
    ['modo básico por cuota', [both, summary({ optionalSkippedForQuota: 17 })], /modo básico/],
    ['fail-open', [both, summary({ outcome: 'failed-open' })], /desactivada por seguridad/],
  ])('%s', (_name, args, expected) => {
    expect(webProtectionStatusText(...args)).toMatch(expected)
  })
})

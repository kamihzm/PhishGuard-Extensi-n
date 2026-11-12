import { describe, expect, it, vi } from 'vitest'
import type { TrustedSite } from '../trustedSites/types'
import { renderTrustedSitesPanel, renderTrustedSitesSummary } from './trustedSitesView'

function noopActions() {
  return {
    onAddDomain: vi.fn(),
    onDeleteHostname: vi.fn(),
    onRequestClearAll: vi.fn(),
    onConfirmClearAll: vi.fn(),
    onCancelClearAll: vi.fn(),
  }
}

function site(hostname: string, addedAt = new Date().toISOString()): TrustedSite {
  return { hostname, addedAt }
}

describe('trustedSitesView', () => {
  it('sin sitios, muestra un mensaje vacío y no la sección de eliminar todos', () => {
    const container = document.createElement('div')
    renderTrustedSitesPanel(container, [], { confirmingClearAll: false }, noopActions())

    expect(container.querySelector('.no-hits')).not.toBeNull()
    expect(container.querySelector('.hist-btn-ghost')?.textContent).toBe('Agregar')
    expect(
      [...container.querySelectorAll('.hist-btn')].some((b) => b.textContent === 'Eliminar todos'),
    ).toBe(false)
  })

  it('lista los sitios confiables con hostname y fecha', () => {
    const container = document.createElement('div')
    renderTrustedSitesPanel(
      container,
      [site('example.com')],
      { confirmingClearAll: false },
      noopActions(),
    )

    expect(container.querySelector('.trusted-item-hostname')?.textContent).toBe('example.com')
    expect(container.querySelector('.trusted-item-added')?.textContent).toBe('Agregado hoy')
  })

  it('enviar el formulario de agregar invoca onAddDomain con el valor y limpia el input', () => {
    const container = document.createElement('div')
    const actions = noopActions()
    renderTrustedSitesPanel(container, [], { confirmingClearAll: false }, actions)

    const input = container.querySelector<HTMLInputElement>('.trusted-add-input')!
    input.value = 'nuevo-sitio.com'
    container
      .querySelector('.trusted-add-form')!
      .dispatchEvent(new Event('submit', { cancelable: true }))

    expect(actions.onAddDomain).toHaveBeenCalledWith('nuevo-sitio.com')
    expect(input.value).toBe('')
  })

  it('enviar el formulario vacío no invoca onAddDomain', () => {
    const container = document.createElement('div')
    const actions = noopActions()
    renderTrustedSitesPanel(container, [], { confirmingClearAll: false }, actions)

    container
      .querySelector('.trusted-add-form')!
      .dispatchEvent(new Event('submit', { cancelable: true }))

    expect(actions.onAddDomain).not.toHaveBeenCalled()
  })

  it('muestra el error de la última adición cuando addError está presente', () => {
    const container = document.createElement('div')
    renderTrustedSitesPanel(
      container,
      [],
      { confirmingClearAll: false, addError: 'esquema inválido' },
      noopActions(),
    )

    expect(container.querySelector('.trusted-add-error')?.textContent).toBe('esquema inválido')
  })

  it('el botón eliminar de un sitio invoca onDeleteHostname con su hostname', () => {
    const container = document.createElement('div')
    const actions = noopActions()
    renderTrustedSitesPanel(
      container,
      [site('a.com'), site('b.com')],
      { confirmingClearAll: false },
      actions,
    )

    const buttons = container.querySelectorAll<HTMLButtonElement>('.history-delete')
    buttons[1]!.click()

    expect(actions.onDeleteHostname).toHaveBeenCalledWith('b.com')
  })

  it('"Eliminar todos" primero pide confirmación (onRequestClearAll) sin borrar nada', () => {
    const container = document.createElement('div')
    const actions = noopActions()
    renderTrustedSitesPanel(container, [site('a.com')], { confirmingClearAll: false }, actions)

    const button = [...container.querySelectorAll('.hist-btn')].find(
      (b) => b.textContent === 'Eliminar todos',
    )
    button?.dispatchEvent(new Event('click'))

    expect(actions.onRequestClearAll).toHaveBeenCalledTimes(1)
    expect(actions.onConfirmClearAll).not.toHaveBeenCalled()
  })

  it('con confirmingClearAll=true, confirmar invoca onConfirmClearAll y cancelar invoca onCancelClearAll', () => {
    const container = document.createElement('div')
    const actions = noopActions()
    renderTrustedSitesPanel(container, [site('a.com')], { confirmingClearAll: true }, actions)

    const confirmButton = [...container.querySelectorAll('.hist-btn')].find(
      (b) => b.textContent === 'Sí, eliminar todos',
    )
    confirmButton?.dispatchEvent(new Event('click'))
    expect(actions.onConfirmClearAll).toHaveBeenCalledTimes(1)

    const cancelButton = [...container.querySelectorAll('.hist-btn')].find(
      (b) => b.textContent === 'Cancelar',
    )
    cancelButton?.dispatchEvent(new Event('click'))
    expect(actions.onCancelClearAll).toHaveBeenCalledTimes(1)
  })

  it('el panel expandido ya no repite el título "SITIOS CONFIABLES" (lo muestra el resumen compacto)', () => {
    const container = document.createElement('div')
    renderTrustedSitesPanel(
      container,
      [site('a.com')],
      { confirmingClearAll: false },
      noopActions(),
    )

    expect(container.querySelector('.stats-section-title')).toBeNull()
  })
})

describe('renderTrustedSitesSummary', () => {
  it('sin sitios, muestra "Ningún sitio permitido" y el botón "Administrar"', () => {
    const container = document.createElement('div')
    renderTrustedSitesSummary(container, 0, { expanded: false }, { onToggleExpanded: vi.fn() })

    expect(container.querySelector('.stats-section-title')?.textContent).toBe('SITIOS CONFIABLES')
    expect(container.querySelector('.trusted-summary-count')?.textContent).toBe(
      'Ningún sitio permitido',
    )
    expect(container.querySelector('.hist-btn')?.textContent).toBe('Administrar')
  })

  it('con 1 sitio, usa singular', () => {
    const container = document.createElement('div')
    renderTrustedSitesSummary(container, 1, { expanded: false }, { onToggleExpanded: vi.fn() })

    expect(container.querySelector('.trusted-summary-count')?.textContent).toBe('1 sitio permitido')
  })

  it('con varios sitios, usa plural con el conteo', () => {
    const container = document.createElement('div')
    renderTrustedSitesSummary(container, 3, { expanded: false }, { onToggleExpanded: vi.fn() })

    expect(container.querySelector('.trusted-summary-count')?.textContent).toBe(
      '3 sitios permitidos',
    )
  })

  it('expanded=true muestra el botón "Ocultar" en vez de "Administrar"', () => {
    const container = document.createElement('div')
    renderTrustedSitesSummary(container, 3, { expanded: true }, { onToggleExpanded: vi.fn() })

    expect(container.querySelector('.hist-btn')?.textContent).toBe('Ocultar')
  })

  it('el botón invoca onToggleExpanded al hacer click', () => {
    const container = document.createElement('div')
    const onToggleExpanded = vi.fn()
    renderTrustedSitesSummary(container, 2, { expanded: false }, { onToggleExpanded })

    container.querySelector<HTMLButtonElement>('.hist-btn')?.click()

    expect(onToggleExpanded).toHaveBeenCalledTimes(1)
  })
})

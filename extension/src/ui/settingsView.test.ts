import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS } from '../settings/defaults'
import { renderSettingsPanel } from './settingsView'

function noopActions() {
  return {
    onToggle: vi.fn(),
    onRequestClearHistory: vi.fn(),
    onConfirmClearHistory: vi.fn(),
    onCancelClearHistory: vi.fn(),
  }
}

function notConfirming() {
  return { confirmingClearHistory: false }
}

describe('settingsView', () => {
  it('muestra los 2 toggles del MVP y "Modo avanzado" (apagado), no guardar-historial ni badge', () => {
    const container = document.createElement('div')
    renderSettingsPanel(
      container,
      { ...DEFAULT_SETTINGS, highRiskWarningEnabled: false },
      notConfirming(),
      noopActions(),
    )

    const checkboxes = container.querySelectorAll<HTMLInputElement>('.settings-toggle-checkbox')
    expect(checkboxes).toHaveLength(3)
    expect([...checkboxes].map((c) => c.checked)).toEqual([true, false, false])

    const labels = [...container.querySelectorAll('.settings-toggle-label')].map(
      (el) => el.textContent,
    )
    expect(labels).toEqual([
      'Protección contra phishing',
      'Advertencias de riesgo alto',
      'Modo avanzado (detalles técnicos)',
    ])
  })

  it('"Modo avanzado": casilla con etiqueta (alcanzable con teclado), explicación corta y onToggle con su clave', () => {
    const container = document.createElement('div')
    const actions = noopActions()
    renderSettingsPanel(container, DEFAULT_SETTINGS, notConfirming(), actions)

    const checkbox = container.querySelectorAll<HTMLInputElement>('.settings-toggle-checkbox')[2]!
    // La casilla está dentro de su <label>: el nombre accesible es el texto de la fila.
    const row = checkbox.closest('label')
    expect(row?.textContent).toContain('Modo avanzado (detalles técnicos)')
    expect(row?.textContent).toContain(
      'Para ver cómo decide PhishGuard: reglas, modelo y puntuación.',
    )
    expect(checkbox.type).toBe('checkbox')
    expect(checkbox.tabIndex).not.toBe(-1)
    expect(checkbox.checked).toBe(false)

    checkbox.checked = true
    checkbox.dispatchEvent(new Event('change'))
    expect(actions.onToggle).toHaveBeenCalledWith('advancedModeEnabled', true)
  })

  it('cambiar un toggle invoca onToggle con la clave y el nuevo valor', () => {
    const container = document.createElement('div')
    const actions = noopActions()
    renderSettingsPanel(container, DEFAULT_SETTINGS, notConfirming(), actions)

    const checkbox = container.querySelectorAll<HTMLInputElement>('.settings-toggle-checkbox')[0]!
    checkbox.checked = false
    checkbox.dispatchEvent(new Event('change'))

    expect(actions.onToggle).toHaveBeenCalledWith('phishingProtectionEnabled', false)
  })

  it('"Borrar historial" primero pide confirmación sin borrar nada', () => {
    const container = document.createElement('div')
    const actions = noopActions()
    renderSettingsPanel(container, DEFAULT_SETTINGS, notConfirming(), actions)

    const button = [...container.querySelectorAll('.hist-btn')].find(
      (b) => b.textContent === 'Borrar historial',
    )
    button?.dispatchEvent(new Event('click'))

    expect(actions.onRequestClearHistory).toHaveBeenCalledTimes(1)
    expect(actions.onConfirmClearHistory).not.toHaveBeenCalled()
  })

  it('con confirmingClearHistory=true, confirmar invoca onConfirmClearHistory', () => {
    const container = document.createElement('div')
    const actions = noopActions()
    renderSettingsPanel(container, DEFAULT_SETTINGS, { confirmingClearHistory: true }, actions)

    const confirmButton = [...container.querySelectorAll('.hist-btn')].find(
      (b) => b.textContent === 'Sí, borrar todo',
    )
    confirmButton?.dispatchEvent(new Event('click'))
    expect(actions.onConfirmClearHistory).toHaveBeenCalledTimes(1)
  })

  it('NO muestra "Restaurar configuración predeterminada" (eliminado en la simplificación del MVP)', () => {
    const container = document.createElement('div')
    renderSettingsPanel(container, DEFAULT_SETTINGS, notConfirming(), noopActions())

    expect(
      [...container.querySelectorAll('.hist-btn')].some(
        (b) => b.textContent === 'Restaurar configuración predeterminada',
      ),
    ).toBe(false)
  })

  it('NO muestra la nota de privacidad (se movió a su propio módulo, ui/privacySection.ts)', () => {
    const container = document.createElement('div')
    renderSettingsPanel(container, DEFAULT_SETTINGS, notConfirming(), noopActions())

    expect(container.querySelector('.settings-privacy-text')).toBeNull()
  })

  it('muestra el título de sección "DATOS"', () => {
    const container = document.createElement('div')
    renderSettingsPanel(container, DEFAULT_SETTINGS, notConfirming(), noopActions())

    const titles = [...container.querySelectorAll('.stats-section-title')].map(
      (el) => el.textContent,
    )
    expect(titles).toEqual(['CONFIGURACIÓN GENERAL', 'DATOS'])
  })
})

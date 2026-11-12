import { describe, expect, it, vi } from 'vitest'
import type { HistoryEntry } from '../history/types'
import { renderHistoryPanel } from './historyView'

function buildEntry(overrides: Partial<HistoryEntry> = {}): HistoryEntry {
  return {
    id: '1',
    url: 'https://example.com/',
    hostname: 'example.com',
    analyzedAt: new Date().toISOString(),
    finalScore: 10,
    ruleScore: 0,
    mlProbability: 0.1,
    riskLevel: 'low',
    activatedRuleIds: [],
    ...overrides,
  }
}

function noopActions() {
  return {
    onFilterChange: vi.fn(),
    onDeleteEntry: vi.fn(),
    onRequestClearAll: vi.fn(),
    onConfirmClearAll: vi.fn(),
    onCancelClearAll: vi.fn(),
  }
}

describe('renderHistoryPanel', () => {
  it('muestra hostname, nivel de riesgo con color y finalScore para cada entrada', () => {
    const container = document.createElement('div')
    renderHistoryPanel(
      container,
      [buildEntry({ hostname: 'evil-login.top', riskLevel: 'high', finalScore: 83 })],
      { filter: 'all', confirmingClearAll: false },
      noopActions(),
    )

    expect(container.querySelector('.history-hostname')?.textContent).toBe('evil-login.top')
    expect(container.querySelector('.history-risk-line')?.textContent).toBe('Riesgo alto · 83/100')
    expect(container.querySelector('.history-dot')?.className).toContain('risk-high')
  })

  it('sin entradas guardadas, muestra un mensaje explícito', () => {
    const container = document.createElement('div')
    renderHistoryPanel(container, [], { filter: 'all', confirmingClearAll: false }, noopActions())

    expect(container.querySelector('.no-hits')?.textContent).toBe(
      'Todavía no hay análisis guardados.',
    )
  })

  it('filtro "low": solo muestra entradas de riesgo bajo', () => {
    const container = document.createElement('div')
    const entries = [
      buildEntry({ id: '1', hostname: 'a.com', riskLevel: 'low' }),
      buildEntry({ id: '2', hostname: 'b.com', riskLevel: 'high' }),
    ]
    renderHistoryPanel(
      container,
      entries,
      { filter: 'low', confirmingClearAll: false },
      noopActions(),
    )

    const hostnames = [...container.querySelectorAll('.history-hostname')].map(
      (el) => el.textContent,
    )
    expect(hostnames).toEqual(['a.com'])
  })

  it('filtro "medium": solo muestra entradas de riesgo medio', () => {
    const container = document.createElement('div')
    const entries = [
      buildEntry({ id: '1', hostname: 'a.com', riskLevel: 'medium' }),
      buildEntry({ id: '2', hostname: 'b.com', riskLevel: 'high' }),
    ]
    renderHistoryPanel(
      container,
      entries,
      { filter: 'medium', confirmingClearAll: false },
      noopActions(),
    )

    const hostnames = [...container.querySelectorAll('.history-hostname')].map(
      (el) => el.textContent,
    )
    expect(hostnames).toEqual(['a.com'])
  })

  it('filtro "high": solo muestra entradas de riesgo alto', () => {
    const container = document.createElement('div')
    const entries = [
      buildEntry({ id: '1', hostname: 'a.com', riskLevel: 'low' }),
      buildEntry({ id: '2', hostname: 'b.com', riskLevel: 'high' }),
    ]
    renderHistoryPanel(
      container,
      entries,
      { filter: 'high', confirmingClearAll: false },
      noopActions(),
    )

    const hostnames = [...container.querySelectorAll('.history-hostname')].map(
      (el) => el.textContent,
    )
    expect(hostnames).toEqual(['b.com'])
  })

  it('el filtro no vuelve a analizar nada: solo notifica la intención vía onFilterChange', () => {
    const container = document.createElement('div')
    const actions = noopActions()
    renderHistoryPanel(
      container,
      [buildEntry()],
      { filter: 'all', confirmingClearAll: false },
      actions,
    )

    const highButton = [...container.querySelectorAll('.filter-chip')].find(
      (b) => b.textContent === 'Alto',
    )
    highButton?.dispatchEvent(new Event('click'))

    expect(actions.onFilterChange).toHaveBeenCalledWith('high')
  })

  it('al hacer clic en una entrada (el <summary>) se puede expandir el detalle: URL completa, fecha, nivel, scores y reglas', () => {
    const container = document.createElement('div')
    renderHistoryPanel(
      container,
      [
        buildEntry({
          url: 'https://evil.example/login',
          ruleScore: 40,
          mlProbability: 0.77,
          activatedRuleIds: ['no-https'],
        }),
      ],
      { filter: 'all', confirmingClearAll: false },
      noopActions(),
    )

    const detailText = container.querySelector('.history-detail')?.textContent ?? ''
    expect(container.querySelector('.history-detail-url')?.textContent).toBe(
      'https://evil.example/login',
    )
    expect(detailText).toContain('Score de reglas: 40/100')
    expect(detailText).toContain('Score del modelo: 77%')
    expect(container.querySelector('.chip')?.textContent).toBe('Conexión no cifrada')
  })

  it('el botón eliminar de una entrada llama a onDeleteEntry con su id y no togglea el detalle', () => {
    const container = document.createElement('div')
    const actions = noopActions()
    renderHistoryPanel(
      container,
      [buildEntry({ id: 'abc' })],
      { filter: 'all', confirmingClearAll: false },
      actions,
    )

    container.querySelector<HTMLButtonElement>('.history-delete')?.click()

    expect(actions.onDeleteEntry).toHaveBeenCalledWith('abc')
  })

  it('"Borrar todo" pide confirmación antes de ejecutar: el primer click no llama a onConfirmClearAll', () => {
    const container = document.createElement('div')
    const actions = noopActions()
    renderHistoryPanel(
      container,
      [buildEntry()],
      { filter: 'all', confirmingClearAll: false },
      actions,
    )

    container.querySelector<HTMLButtonElement>('.hist-btn-ghost')?.click()

    expect(actions.onRequestClearAll).toHaveBeenCalledTimes(1)
    expect(actions.onConfirmClearAll).not.toHaveBeenCalled()
  })

  it('en estado de confirmación, muestra el texto de confirmación y los botones sí/cancelar', () => {
    const container = document.createElement('div')
    const actions = noopActions()
    renderHistoryPanel(
      container,
      [buildEntry()],
      { filter: 'all', confirmingClearAll: true },
      actions,
    )

    expect(container.querySelector('.clear-all-confirm-text')).not.toBeNull()

    container.querySelector<HTMLButtonElement>('.hist-btn-danger')?.click()
    expect(actions.onConfirmClearAll).toHaveBeenCalledTimes(1)
  })

  it('sin ninguna entrada, no muestra el botón de "Borrar todo"', () => {
    const container = document.createElement('div')
    renderHistoryPanel(container, [], { filter: 'all', confirmingClearAll: false }, noopActions())

    expect(container.querySelector('.hist-btn')).toBeNull()
  })

  it('siempre muestra el aviso de privacidad', () => {
    const container = document.createElement('div')
    renderHistoryPanel(container, [], { filter: 'all', confirmingClearAll: false }, noopActions())

    expect(container.querySelector('.privacy-note')?.textContent).toBe(
      'El historial se guarda únicamente en este navegador.',
    )
  })
})

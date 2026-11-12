import { describe, expect, it, vi } from 'vitest'
import type { Decision } from '../../agent/types'
import { renderWarning, renderWarningUnavailable } from './renderWarning'

function buildDecision(overrides: Partial<Decision> = {}): Decision {
  return {
    url: 'https://xn--pypal-4ve.com/account',
    ruleScore: 65,
    mlProbability: 0.528,
    finalScore: 65,
    riskLevel: 'high',
    activatedRules: [
      { id: 'punycode', weight: 30, explanation: 'El dominio usa Punycode.' },
      { id: 'many-hyphens', weight: 10, explanation: 'El dominio tiene guiones.' },
      { id: 'sensitive-words', weight: 10, explanation: 'Palabra sensible.' },
      { id: 'high-entropy-domain', weight: 15, explanation: 'Entropía alta.' },
    ],
    explanation: 'texto completo generado por agent/explain.ts',
    ...overrides,
  }
}

function notConfirmingTrust() {
  return { confirmingTrust: false }
}

function noopActions() {
  return {
    onGoBack: vi.fn(),
    onContinueAnyway: vi.fn(),
    onRequestTrust: vi.fn(),
    onConfirmTrust: vi.fn(),
    onCancelTrust: vi.fn(),
  }
}

describe('renderWarning', () => {
  it('muestra la marca, el veredicto en una frase, el destino real y la dirección completa', () => {
    const container = document.createElement('div')
    renderWarning(
      container,
      buildDecision({
        url: 'http://accounts.google.com@evil-login.top/',
        activatedRules: [{ id: 'at-symbol', weight: 30, explanation: 'Usa @.' }],
      }),
      notConfirmingTrust(),
      noopActions(),
    )

    expect(container.querySelector('.brand')?.textContent).toBe('PhishGuard detuvo esta página')
    expect(container.querySelector('h1.headline')?.textContent).toBe(
      'Este sitio podría robar tus datos',
    )
    expect(container.querySelector('.warning-card')?.getAttribute('aria-labelledby')).toBe(
      'warning-headline',
    )
    expect(container.querySelector('.destination-label')?.textContent).toBe(
      'Parece accounts.google.com, pero en realidad te lleva a',
    )
    expect(container.querySelector('.destination-domain')?.textContent).toBe('evil-login.top')
    expect(container.querySelector('.analyzed-url')?.textContent).toBe(
      'http://accounts.google.com@evil-login.top/',
    )
  })

  it('la puntuación queda solo en "Ver detalles técnicos", con ruleScore/mlProbability tal cual llegan, sin recalcular', () => {
    const container = document.createElement('div')
    renderWarning(
      container,
      buildDecision({ finalScore: 83, ruleScore: 75, mlProbability: 0.87 }),
      notConfirmingTrust(),
      noopActions(),
      { advanced: true },
    )

    expect(container.querySelector('.tech-details .analysis-result')?.textContent).toBe(
      'Puntuación: 83 de 100 · Riesgo alto',
    )
    const outside = container.cloneNode(true) as HTMLElement
    outside.querySelector('.tech-details')?.remove()
    expect(outside.textContent).not.toMatch(/83|\/100|de 100/)

    const advanced = container.querySelector('.advanced-body')?.textContent ?? ''
    expect(advanced).toContain('Puntuación de reglas: 75/100')
    expect(advanced).toContain('Score del modelo: 87.0%')
    expect(advanced).toContain('Resultado combinado: 83/100')
  })

  it('muestra todas las reglas activadas como motivos numerados, una vez cada una', () => {
    const container = document.createElement('div')
    renderWarning(
      container,
      buildDecision({
        activatedRules: [
          { id: 'suspicious-tld', weight: 20, explanation: 'e1' },
          { id: 'no-https', weight: 15, explanation: 'e2' },
          { id: 'sensitive-words', weight: 10, explanation: 'e3' },
          { id: 'many-hyphens', weight: 10, explanation: 'e4' },
          { id: 'high-entropy-domain', weight: 15, explanation: 'e5' },
        ],
      }),
      notConfirmingTrust(),
      noopActions(),
    )

    expect(container.querySelectorAll('.signals ol.signal-list li')).toHaveLength(5)
    expect(container.querySelector('.signals h2')?.textContent).toBe('Por qué te avisamos')
    expect(container.querySelector('.signal-more')).toBeNull()
  })

  it('sin reglas activadas, lo explica en lenguaje natural', () => {
    const container = document.createElement('div')
    renderWarning(
      container,
      buildDecision({ activatedRules: [] }),
      notConfirmingTrust(),
      noopActions(),
    )

    expect(container.querySelector('.signal-list')).toBeNull()
    expect(container.querySelector('.no-hits')?.textContent).toContain(
      'la dirección en conjunto se parece a la de sitios falsos',
    )
    expect(container.querySelector('.short-explanation')?.textContent).not.toContain(
      'Machine Learning',
    )
    // Fuera de "Ver detalles técnicos" no se habla de probabilidad (ver advanced-note).
    container.querySelector('.tech-details')?.remove()
    expect(container.textContent).not.toContain('probabilidad')
  })

  it('"Ver detalles técnicos" muestra la puntuación y conserva los detalles técnicos de cada regla', () => {
    const container = document.createElement('div')
    renderWarning(
      container,
      buildDecision({ explanation: 'texto único de prueba' }),
      notConfirmingTrust(),
      noopActions(),
      { advanced: true },
    )

    expect(container.querySelector('.tech-summary')?.textContent).toBe('Ver detalles técnicos')
    expect(container.querySelector<HTMLDetailsElement>('.tech-details')?.open).toBe(false)
    expect(container.querySelector('.analysis-result')?.textContent).toBe(
      'Puntuación: 65 de 100 · Riesgo alto',
    )
    const advanced = container.querySelector('.advanced-body')?.textContent ?? ''
    expect(advanced).toContain('Punycode')
    expect(advanced).toContain('El dominio usa Punycode.')
    expect(advanced).toContain('Modelo: Random Forest (100 árboles, calibrado)')
    expect(container.querySelector('.tip-contextual')?.textContent).toBe(
      'No escribas contraseñas ni datos de pago en esta página. Si necesitas entrar, escribe tú mismo la dirección oficial.',
    )
  })

  it('el botón "Volver a un sitio seguro" invoca onGoBack al hacer click', () => {
    const container = document.createElement('div')
    const actions = noopActions()
    renderWarning(container, buildDecision(), notConfirmingTrust(), actions)

    const button = [...container.querySelectorAll('.btn')].find(
      (b) => b.textContent === 'Volver a un sitio seguro',
    )
    button?.dispatchEvent(new Event('click'))

    expect(actions.onGoBack).toHaveBeenCalledTimes(1)
    expect(actions.onContinueAnyway).not.toHaveBeenCalled()
  })

  it('el botón "Continuar de todas formas" invoca onContinueAnyway al hacer click', () => {
    const container = document.createElement('div')
    const actions = noopActions()
    renderWarning(container, buildDecision(), notConfirmingTrust(), actions)

    const button = [...container.querySelectorAll('.btn')].find(
      (b) => b.textContent === 'Continuar de todas formas',
    )
    button?.dispatchEvent(new Event('click'))

    expect(actions.onContinueAnyway).toHaveBeenCalledTimes(1)
    expect(actions.onGoBack).not.toHaveBeenCalled()
  })

  it('reemplaza el contenido anterior en vez de acumularlo', () => {
    const container = document.createElement('div')
    renderWarning(
      container,
      buildDecision({ url: 'https://a.example/' }),
      notConfirmingTrust(),
      noopActions(),
    )
    renderWarning(
      container,
      buildDecision({ url: 'https://b.example/' }),
      notConfirmingTrust(),
      noopActions(),
    )

    expect(container.querySelectorAll('.warning-card')).toHaveLength(1)
    expect(container.querySelector('.analyzed-url')?.textContent).toBe('https://b.example/')
  })

  it('"Confiar en este sitio" y "Continuar" son enlaces discretos; la única acción principal es volver', () => {
    const container = document.createElement('div')
    renderWarning(container, buildDecision(), notConfirmingTrust(), noopActions())

    expect(container.querySelector('.link-trust')?.textContent).toBe('Confiar en este sitio')
    expect(container.querySelector('.trust-confirm-text')).toBeNull()
    expect([...container.querySelectorAll('.actions button')].map((b) => b.textContent)).toEqual([
      'Volver a un sitio seguro',
    ])
    expect(container.querySelector('.secondary-actions .btn-continue')?.textContent).toBe(
      'Continuar de todas formas',
    )
    expect(container.querySelector('.trust-section')?.getAttribute('aria-live')).toBe('polite')
  })

  it('al hacer click en "Confiar en este sitio" invoca onRequestTrust', () => {
    const container = document.createElement('div')
    const actions = noopActions()
    renderWarning(container, buildDecision(), notConfirmingTrust(), actions)

    container.querySelector<HTMLButtonElement>('.link-trust')?.click()

    expect(actions.onRequestTrust).toHaveBeenCalledTimes(1)
  })

  it('con confirmingTrust=true, muestra el texto de confirmación con el hostname y los botones sí/cancelar', () => {
    const container = document.createElement('div')
    renderWarning(
      container,
      buildDecision({ url: 'https://evil-login.top/account' }),
      { confirmingTrust: true },
      noopActions(),
    )

    expect(container.querySelector('.link-trust')).toBeNull()
    expect(container.querySelector('.btn-continue')).not.toBeNull()
    expect(container.querySelector('.trust-confirm-text')?.textContent).toContain('evil-login.top')
    expect(container.querySelector('.btn-trust-confirm')?.textContent).toBe('Sí, confiar')
    expect(container.querySelector('.btn-trust-cancel')?.textContent).toBe('Cancelar')
  })

  it('confirmar o cancelar la confianza invoca la acción correspondiente', () => {
    const container = document.createElement('div')
    const actions = noopActions()
    renderWarning(container, buildDecision(), { confirmingTrust: true }, actions)

    container.querySelector<HTMLButtonElement>('.btn-trust-confirm')?.click()
    expect(actions.onConfirmTrust).toHaveBeenCalledTimes(1)
    expect(actions.onCancelTrust).not.toHaveBeenCalled()

    container.querySelector<HTMLButtonElement>('.btn-trust-cancel')?.click()
    expect(actions.onCancelTrust).toHaveBeenCalledTimes(1)
  })

  it('NO muestra ninguna opción de reportar un error de clasificación (desconectado en la simplificación del MVP)', () => {
    const container = document.createElement('div')
    renderWarning(container, buildDecision(), notConfirmingTrust(), noopActions())

    expect(container.querySelector('.link-feedback-report')).toBeNull()
    expect(container.querySelector('.feedback-thanks-text')).toBeNull()
  })
})

describe('renderWarning — modo normal y modo avanzado', () => {
  it('modo normal (por defecto): sin "Ver detalles técnicos", sin puntuación ni palabras técnicas', () => {
    const container = document.createElement('div')
    renderWarning(container, buildDecision(), notConfirmingTrust(), noopActions())
    expect(container.querySelector('.tech-details')).toBeNull()
    expect(container.textContent).not.toMatch(
      /regla|modelo|sistema experto|random forest|score|puntuaci[oó]n|\/100|de 100|detalles técnicos/i,
    )
    expect(container.querySelector('h1.headline')?.textContent).toBe(
      'Este sitio podría robar tus datos',
    )
    expect(container.querySelector('.tip .tip-contextual')).not.toBeNull()
  })

  it('modo avanzado: muestra "Ver detalles técnicos" con la puntuación', () => {
    const container = document.createElement('div')
    renderWarning(container, buildDecision(), notConfirmingTrust(), noopActions(), {
      advanced: true,
    })
    expect(container.querySelector('.tech-summary')?.textContent).toBe('Ver detalles técnicos')
    expect(container.textContent).toContain('Puntuación: 65 de 100')
  })
})

describe('renderWarningUnavailable', () => {
  it('4) identificador inexistente (o cualquier contexto no encontrado) muestra un fallback útil, no una pantalla en blanco', () => {
    const container = document.createElement('div')
    renderWarningUnavailable(container, { onCloseTab: vi.fn(), onNewTab: vi.fn() })

    expect(container.querySelector('.headline')?.textContent).toBe(
      'No se pudo recuperar el análisis',
    )
    expect(container.querySelector('.brand')?.textContent).toBe('PhishGuard')
  })

  it('el botón "Cerrar pestaña" invoca onCloseTab', () => {
    const container = document.createElement('div')
    const actions = { onCloseTab: vi.fn(), onNewTab: vi.fn() }
    renderWarningUnavailable(container, actions)

    const button = [...container.querySelectorAll('.btn')].find(
      (b) => b.textContent === 'Cerrar pestaña',
    )
    button?.dispatchEvent(new Event('click'))

    expect(actions.onCloseTab).toHaveBeenCalledTimes(1)
    expect(actions.onNewTab).not.toHaveBeenCalled()
  })

  it('el botón "Ir a nueva pestaña" invoca onNewTab', () => {
    const container = document.createElement('div')
    const actions = { onCloseTab: vi.fn(), onNewTab: vi.fn() }
    renderWarningUnavailable(container, actions)

    const button = [...container.querySelectorAll('.btn')].find(
      (b) => b.textContent === 'Ir a nueva pestaña',
    )
    button?.dispatchEvent(new Event('click'))

    expect(actions.onNewTab).toHaveBeenCalledTimes(1)
    expect(actions.onCloseTab).not.toHaveBeenCalled()
  })
})

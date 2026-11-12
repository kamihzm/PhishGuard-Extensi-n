import { describe, expect, it } from 'vitest'
import { decide } from '../agent/orchestrator'
import type { Decision } from '../agent/types'
import { presentRisk, renderDecision, renderUnavailable } from './render'

function buildDecision(overrides: Partial<Decision> = {}): Decision {
  return {
    url: 'https://example.com/',
    ruleScore: 0,
    mlProbability: 0,
    finalScore: 0,
    riskLevel: 'low',
    activatedRules: [],
    explanation:
      'Sistema experto: no se activó ninguna regla conocida.\n\nMachine Learning (regresión logística): 0% de probabilidad estimada de phishing.\n\nResultado combinado: riesgo bajo (score 0/100).',
    ...overrides,
  }
}

describe('presentRisk', () => {
  it('mapea cada nivel de riesgo a su etiqueta, clase y veredicto — sin repetir umbrales (esos ya los decidió combine.ts)', () => {
    expect(presentRisk('low')).toEqual({
      label: 'Bajo riesgo',
      className: 'risk-low',
      message: 'No encontramos señales de riesgo',
    })
    expect(presentRisk('medium')).toEqual({
      label: 'Riesgo medio',
      className: 'risk-medium',
      message: 'Ten cuidado con este sitio',
    })
    expect(presentRisk('high')).toEqual({
      label: 'Riesgo alto',
      className: 'risk-high',
      message: 'Este sitio podría robar tus datos',
    })
  })
})

const ADVANCED = { advanced: true }

/** Palabras técnicas que el modo normal no debe mostrar. */
const TECHNICAL_WORDS =
  /regla|modelo|sistema experto|random forest|score|puntuaci[oó]n|\/100|de 100|detalles técnicos|consejos/i

/** Texto visible sin abrir "Ver detalles técnicos". */
function textOutsideTechnical(container: HTMLElement): string {
  const copy = container.cloneNode(true) as HTMLElement
  copy.querySelector('.tech-details')?.remove()
  return copy.textContent ?? ''
}

describe('renderDecision', () => {
  it.each([
    ['low', 11, 'risk-low', 'Bajo riesgo', 'No encontramos señales de riesgo'],
    ['medium', 35, 'risk-medium', 'Riesgo medio', 'Ten cuidado con este sitio'],
    ['high', 91, 'risk-high', 'Riesgo alto', 'Este sitio podría robar tus datos'],
  ] as const)(
    '%s: veredicto en una frase con su clase y su palabra de nivel (no solo color)',
    (riskLevel, finalScore, className, label, verdict) => {
      const container = document.createElement('div')
      renderDecision(container, buildDecision({ finalScore, riskLevel }))

      expect(container.querySelector('.verdict')?.className).toContain(className)
      expect(container.querySelector('.risk-label')?.textContent).toBe(label)
      expect(container.querySelector('h1.verdict-title')?.textContent).toBe(verdict)
      expect(container.querySelector('.verdict')?.getAttribute('aria-labelledby')).toBe(
        'verdict-title',
      )
      expect(container.querySelector('.verdict-icon svg')?.getAttribute('aria-hidden')).toBe('true')
    },
  )

  it('la puntuación (p. ej. 35/100) solo aparece dentro de "Ver detalles técnicos"', () => {
    const container = document.createElement('div')
    renderDecision(container, buildDecision({ finalScore: 35, riskLevel: 'medium' }), ADVANCED)

    expect(textOutsideTechnical(container)).not.toMatch(/35|\/100|de 100/)
    expect(container.querySelector('.tech-details .analysis-result')?.textContent).toBe(
      'Puntuación: 35 de 100 · Riesgo medio',
    )
  })

  it('en nivel bajo nunca dice "seguro"', () => {
    const container = document.createElement('div')
    renderDecision(container, buildDecision({ finalScore: 3, riskLevel: 'low' }))
    expect(container.textContent).not.toMatch(/segur[oa]/i)
    expect(container.querySelector('.verdict-title')?.textContent).toBe(
      'No encontramos señales de riesgo',
    )
  })

  it('4) muestra ruleScore tal cual llega en el Decision, sin recalcularlo (solo en detalles técnicos)', () => {
    const container = document.createElement('div')
    renderDecision(container, buildDecision({ ruleScore: 70 }), ADVANCED)

    expect(container.querySelector('.advanced-body')?.textContent).toContain(
      'Puntuación de reglas: 70/100',
    )
    expect(textOutsideTechnical(container)).not.toContain('70')
  })

  it('5) muestra mlProbability tal cual llega en el Decision, como "Score del modelo" y solo en detalles técnicos', () => {
    const container = document.createElement('div')
    renderDecision(container, buildDecision({ mlProbability: 0.389 }), ADVANCED)

    expect(container.querySelector('.advanced-model-score')?.textContent).toBe(
      'Score del modelo: 38.9%',
    )
    expect(container.textContent).not.toContain('Probabilidad')
    expect(container.textContent).not.toContain('probabilidad de phishing')
  })

  it('6) muestra activatedRules como motivos numerados en lenguaje natural, y la explicación técnica en detalles técnicos', () => {
    const container = document.createElement('div')
    renderDecision(
      container,
      buildDecision({
        riskLevel: 'medium',
        activatedRules: [
          { id: 'suspicious-tld', weight: 20, explanation: 'El dominio usa un TLD sospechoso.' },
          { id: 'no-https', weight: 15, explanation: 'El sitio no usa HTTPS.' },
        ],
      }),
      ADVANCED,
    )

    expect(container.querySelector('.signals-card h2')?.textContent).toBe('Por qué te avisamos')
    const signals = [...container.querySelectorAll('.signals-card ol.signal-list li')].map(
      (li) => li.textContent,
    )
    expect(signals).toEqual([
      'El nombre del sitio termina de una forma poco común, muy usada en engaños.',
      'La conexión con este sitio no está protegida: otros podrían ver lo que escribas.',
    ])

    const advanced = container.querySelector('.advanced-body')?.textContent ?? ''
    expect(advanced).toContain('TLD sospechoso')
    expect(advanced).toContain('El dominio usa un TLD sospechoso.')
  })

  it('7) bajo sin reglas activadas: no muestra lista de motivos y lo indica en detalles técnicos', () => {
    const container = document.createElement('div')
    renderDecision(container, buildDecision({ activatedRules: [] }), ADVANCED)

    expect(container.querySelector('.signals-card')).toBeNull()
    expect(container.querySelector('.advanced-body')?.textContent).toContain(
      'Reglas activadas: ninguna.',
    )
  })

  it('7b) medio sin reglas: explica en palabras simples que la dirección en conjunto se parece a sitios falsos', () => {
    const container = document.createElement('div')
    renderDecision(container, buildDecision({ riskLevel: 'medium', finalScore: 40 }))
    expect(container.querySelector('.signals-card .no-hits')?.textContent).toContain(
      'la dirección en conjunto se parece a la de sitios falsos',
    )
  })

  it('8) muchas reglas: muestra todos los motivos y cada uno una sola vez (sin repetirlos en otra sección)', () => {
    const container = document.createElement('div')
    const activatedRules: Decision['activatedRules'] = [
      { id: 'suspicious-tld', weight: 20, explanation: 'e1' },
      { id: 'no-https', weight: 15, explanation: 'e2' },
      { id: 'sensitive-words', weight: 10, explanation: 'e3' },
      { id: 'many-hyphens', weight: 10, explanation: 'e4' },
      { id: 'high-entropy-domain', weight: 15, explanation: 'e5' },
      { id: 'long-url', weight: 10, explanation: 'e6' },
    ]
    renderDecision(container, buildDecision({ riskLevel: 'high', activatedRules }), ADVANCED)

    const items = [...container.querySelectorAll('.signals-card .signal-list li')]
    expect(items).toHaveLength(6)
    const text = container.textContent ?? ''
    for (const item of items) expect(text.split(item.textContent!).length - 1).toBe(1)
    expect(container.querySelectorAll('.tech-rule-list li')).toHaveLength(6)
  })

  it('9) "Ver detalles técnicos" (modo avanzado) empieza cerrado y puede abrirse/cerrarse (accordion nativo <details>)', () => {
    const container = document.createElement('div')
    renderDecision(container, buildDecision(), ADVANCED)

    const details = container.querySelector<HTMLDetailsElement>('.tech-details')
    expect(details).not.toBeNull()
    expect(details?.querySelector('.tech-summary')?.textContent).toBe('Ver detalles técnicos')
    expect(details?.open).toBe(false)

    details!.open = true
    expect(details?.open).toBe(true)
  })

  it('10) una URL extremadamente larga no rompe la UI: el contenido completo sigue presente (la trunca solo el CSS) y queda disponible en el title', () => {
    const container = document.createElement('div')
    const longUrl = `https://example.com/${'a'.repeat(300)}?param=${'b'.repeat(300)}`
    renderDecision(container, buildDecision({ url: longUrl }))

    const urlEl = container.querySelector('.analyzed-url')
    expect(urlEl?.textContent).toBe(longUrl)
    expect(urlEl?.getAttribute('title')).toBe(longUrl)
    expect(container.querySelectorAll('.analyzed-url')).toHaveLength(1)
  })

  it('muestra los rangos de cada nivel, importados de agent/combine.ts, dentro de detalles técnicos', () => {
    const container = document.createElement('div')
    renderDecision(container, buildDecision(), ADVANCED)

    expect(container.querySelector('.tech-details .legend')?.textContent).toBe(
      'Bajo: 0–34 · Medio: 35–64 · Alto: 65–100',
    )
  })

  it('muestra "Qué hacer" con un solo consejo según el nivel, sin lista de consejos generales', () => {
    const container = document.createElement('div')
    renderDecision(container, buildDecision())

    expect(container.querySelector('.tips-card h2')?.textContent).toBe('Qué hacer')
    expect(container.querySelector('.tip-contextual')?.textContent).toBe(
      'Antes de escribir contraseñas o datos de pago, revisa que la dirección sea la del sitio oficial.',
    )
    expect(container.querySelector('.tips-details')).toBeNull()
    expect(container.textContent).not.toContain('Más consejos')
  })

  it('reemplaza el contenido anterior en vez de acumularlo', () => {
    const container = document.createElement('div')
    renderDecision(container, buildDecision({ url: 'https://a.com/' }))
    renderDecision(container, buildDecision({ url: 'https://b.com/', finalScore: 10 }))

    expect(container.querySelectorAll('.verdict')).toHaveLength(1)
    expect(container.querySelector('.analyzed-url')?.textContent).toBe('https://b.com/')
  })
})

describe('modo normal y modo avanzado (Ajustes)', () => {
  it.each(['low', 'medium', 'high'] as const)(
    '%s, modo normal (por defecto): solo veredicto, motivos, destino y "Qué hacer", sin nada técnico',
    (riskLevel) => {
      const container = document.createElement('div')
      renderDecision(
        container,
        buildDecision({
          riskLevel,
          finalScore: 50,
          ruleScore: 40,
          mlProbability: 0.6,
          activatedRules: [{ id: 'sensitive-words', weight: 10, explanation: 'e' }],
        }),
      )
      expect(container.querySelector('.tech-details')).toBeNull()
      expect(container.querySelector('.tips-details')).toBeNull()
      expect(container.querySelector('.verdict-title')).not.toBeNull()
      expect(container.querySelector('.destination-card')).not.toBeNull()
      expect(container.querySelector('.signals-card')).not.toBeNull()
      expect(container.querySelector('.tips-card .tip-contextual')).not.toBeNull()
      expect(container.textContent).not.toMatch(TECHNICAL_WORDS)
      expect(container.textContent).not.toMatch(/\b50\b|\b40\b/)
    },
  )

  it('modo avanzado: agrega "Ver detalles técnicos" con la puntuación, las reglas y el modelo', () => {
    const container = document.createElement('div')
    renderDecision(container, buildDecision({ finalScore: 35, riskLevel: 'medium' }), ADVANCED)
    expect(container.querySelector('.tech-summary')?.textContent).toBe('Ver detalles técnicos')
    expect(container.textContent).toContain('Puntuación: 35 de 100')
    expect(container.textContent).toContain('Random Forest')
  })
})

describe('destino real ("Estás en" / "En realidad te lleva a")', () => {
  it('sin disfraz: "Estás en" y el dominio registrable', () => {
    const container = document.createElement('div')
    renderDecision(container, decide('https://www.biblioteca.example/catalogo'))
    expect(container.querySelector('.destination-label')?.textContent).toBe('Estás en')
    expect(container.querySelector('.destination-domain')?.textContent).toBe('biblioteca.example')
  })

  it('con @ (bancolombia.com@login.example): destaca a dónde lleva de verdad', () => {
    const decision = decide('https://www.bancolombia.com@login.example/')
    expect(decision.riskLevel).toBe('high')
    const container = document.createElement('div')
    renderDecision(container, decision)
    expect(container.querySelector('.destination-label')?.textContent).toBe(
      'Parece www.bancolombia.com, pero en realidad te lleva a',
    )
    expect(container.querySelector('.destination-domain')?.textContent).toBe('login.example')
  })

  it('marca delante de otro dominio (paypal.com.login.example): el dominio real es login.example', () => {
    const decision = decide('https://paypal.com.login.example/')
    expect(decision.riskLevel).toBe('medium')
    const container = document.createElement('div')
    renderDecision(container, decision)
    expect(container.querySelector('.destination-label')?.textContent).toBe(
      'Parece paypal.com, pero en realidad te lleva a',
    )
    expect(container.querySelector('.destination-domain')?.textContent).toBe('login.example')
    expect(container.querySelector('.signal-list')?.textContent).toContain(
      'Usa el nombre paypal delante de un sitio que no es de esa marca.',
    )
  })
})

describe('renderUnavailable', () => {
  it('muestra el mensaje dado', () => {
    const container = document.createElement('div')

    renderUnavailable(container, 'No se pudo analizar la URL de esta pestaña.')

    expect(container.querySelector('.unavailable')?.textContent).toBe(
      'No se pudo analizar la URL de esta pestaña.',
    )
  })
})

import { describe, expect, it } from 'vitest'
import { decide } from '../agent/orchestrator'
import type { Decision } from '../agent/types'
import { buildHumanExplanation, signalTextFor } from './humanExplanation'
import { renderDecision } from './render'
import { RULE_SIGNAL_TEXTS } from './ruleLabels'

/** Jerga que no debe aparecer en la vista principal (solo en "Ver detalles técnicos"). */
const TECHNICAL_TERMS = [
  'Sistema experto',
  'Machine Learning',
  'regresión',
  'Regresión',
  'logit',
  'feature',
  'threshold',
  'umbral',
  'probabilidad',
  'Probabilidad',
  'Entropía',
  'entropía',
  'TLD',
  'Punycode',
  'impersonation',
  'At-symbol',
  'técnico',
  'regla',
  'modelo',
  'Random Forest',
  'score',
  'Puntuación',
  'cifrad',
  'subdominio',
  'dominio',
]

/** Texto visible en el modo normal (sin modo avanzado), salvo la dirección analizada. */
function visibleTextWithoutAdvanced(decision: Decision): string {
  const container = document.createElement('div')
  renderDecision(container, decision)
  container.querySelector('.analyzed-url')?.remove()
  container.querySelector('.destination-domain')?.remove()
  return container.textContent ?? ''
}

// URLs reales pasadas por el pipeline completo (reglas + ML + combinación sin cambios).
const CASES = {
  lowNoSignals: 'https://www.leagueoflegends.com/es-es/',
  lowWithSignal: 'https://www.bancolombia.com/',
  mediumOneSignal: 'https://www.harley-davidson.com/',
  // IP privada + HTTP + "login"/"verificar": 3 señales no fuertes → piso de "medio". (Antes este
  // caso usaba la IP pública 45.33.32.156, que desde 2026-10-01 es "alto" por la regla
  // `ip-host-sensitive-path`.)
  mediumCorroborated: 'http://192.168.1.50/login?verificar=1',
  highManySignals: 'https://secure-login-verificar-cuenta-banco.top/wp-includes/session.php',
  highStrongSignal: 'http://accounts.google.com@evil-login.top/',
}

describe('explicación en lenguaje natural sobre decisiones reales', () => {
  it.each(Object.entries(CASES))(
    '%s: la puntuación mostrada es exactamente la calculada',
    (_name, url) => {
      const decision = decide(url)
      const container = document.createElement('div')
      renderDecision(container, decision, { advanced: true })

      expect(container.querySelector('.analysis-result')?.textContent).toContain(
        `Puntuación: ${decision.finalScore} de 100`,
      )
      expect(container.querySelector('.advanced-final-score')?.textContent).toBe(
        `Resultado combinado: ${decision.finalScore}/100`,
      )
      expect(container.querySelector('.advanced-model-score')?.textContent).toBe(
        `Score del modelo: ${(decision.mlProbability * 100).toFixed(1)}%`,
      )
    },
  )

  it.each(Object.entries(CASES))(
    '%s: una frase por cada señal realmente activada',
    (_name, url) => {
      const decision = decide(url)
      expect(buildHumanExplanation(decision).signals).toEqual(
        decision.activatedRules.map(signalTextFor),
      )
    },
  )

  it.each(Object.entries(CASES))(
    '%s: sin jerga técnica fuera de "Ver detalles técnicos"',
    (_name, url) => {
      const text = visibleTextWithoutAdvanced(decide(url))
      for (const term of TECHNICAL_TERMS) expect(text).not.toContain(term)
    },
  )

  it('bajo riesgo sin señales (League of Legends): mensaje tranquilo, sin prometer seguridad total', () => {
    const decision = decide(CASES.lowNoSignals)
    expect(decision.riskLevel).toBe('low')
    expect(decision.activatedRules).toEqual([])

    const human = buildHumanExplanation(decision)
    expect(human.verdict).toBe('No encontramos señales de riesgo')
    expect(human.headline).toBe(
      'Revisamos la dirección de este sitio y no vimos nada que indique un engaño.',
    )
    expect(human.noSignalsText).toBe('')
    expect(human.reasoning).toContain('No se activó ninguna regla.')
    expect(human.tip).toContain('revisa que la dirección sea la del sitio oficial')
    expect(Object.values(human).flat().join(' ')).not.toMatch(/segur[oa]/i)
  })

  it('bajo riesgo con una señal menor: lo reconoce sin alarmar', () => {
    const decision = decide(CASES.lowWithSignal)
    expect(decision.riskLevel).toBe('low')
    expect(decision.activatedRules.length).toBeGreaterThan(0)
    const human = buildHumanExplanation(decision)
    expect(human.verdict).toBe('No encontramos señales de riesgo importantes')
    expect(human.headline).toBe(
      'Vimos un detalle menor en la dirección, pero en conjunto no indica un engaño.',
    )
    expect(human.signalsHeading).toBe('Lo que vimos')
  })

  it('riesgo medio sin señales concretas: lo explica en palabras simples', () => {
    // Forma de Decision que produce combine.ts cuando solo el modelo empuja a "medio" (0 reglas, score ≥ 0.5).
    const decision: Decision = {
      url: 'https://ejemplo-largo.example/',
      ruleScore: 0,
      mlProbability: 0.6,
      finalScore: 42,
      riskLevel: 'medium',
      activatedRules: [],
      explanation: '',
    }

    const human = buildHumanExplanation(decision)
    expect(human.verdict).toBe('Ten cuidado con este sitio')
    expect(human.noSignalsText).toBe(
      'No hay un motivo concreto, pero la dirección en conjunto se parece a la de sitios falsos.',
    )
    expect(human.reasoning).toContain(
      'El análisis automático encontró que la forma de la dirección se parece a la de sitios falsos.',
    )
    expect(human.tip).toBe(
      'Si vas a iniciar sesión o pagar, escribe tú mismo la dirección oficial en lugar de usar este enlace.',
    )
  })

  it('riesgo medio por varias señales juntas: lo explica', () => {
    const decision = decide(CASES.mediumCorroborated)
    expect(decision.riskLevel).toBe('medium')
    expect(buildHumanExplanation(decision).reasoning).toContain(
      'Varias señales aparecieron a la vez, lo que por sí solo justifica precaución.',
    )
  })

  it('riesgo alto con señal fuerte (@ que oculta el destino): lo explica sin tecnicismos', () => {
    const decision = decide(CASES.highStrongSignal)
    expect(decision.riskLevel).toBe('high')

    const human = buildHumanExplanation(decision)
    expect(human.verdict).toBe('Este sitio podría robar tus datos')
    expect(human.signals).toContain(
      'La dirección esconde el sitio real: lo que aparece antes de la @ no es el sitio al que vas.',
    )
    expect(human.reasoning).toContain(
      'Al menos una de las señales es, por sí sola, un indicador fuerte de engaño.',
    )
    expect(human.tip).toBe(
      'No escribas contraseñas ni datos de pago en esta página. Si necesitas entrar, escribe tú mismo la dirección oficial.',
    )
  })

  it('página con múltiples señales: todas están en la lista de motivos y no se repiten en "Cómo se decidió"', () => {
    const decision = decide(CASES.highManySignals)
    expect(decision.activatedRules.length).toBeGreaterThanOrEqual(4)
    const human = buildHumanExplanation(decision)
    for (const hit of decision.activatedRules) {
      expect(human.signals).toContain(signalTextFor(hit))
      expect(human.reasoning).not.toContain(signalTextFor(hit))
    }
  })
})

describe('homoglifos: la marca imitada aparece en la lista principal', () => {
  it('xn--pypal-4ve.example (а cirílica): "Usa letras de otro alfabeto para imitar a paypal.com."', () => {
    const decision = decide('https://xn--pypal-4ve.example/')
    expect(decision.riskLevel).toBe('high')
    const human = buildHumanExplanation(decision)
    expect(human.signals).toContain('Usa letras de otro alfabeto para imitar a paypal.com.')
    expect(visibleTextWithoutAdvanced(decision)).toContain('paypal.com')
  })

  it('mezcla de escrituras sin marca reconocida: se mantiene la frase genérica', () => {
    const hit = {
      id: 'punycode-deceptive' as const,
      weight: 30,
      explanation:
        'El dominio se ve como "xyzсайт.example" y mezcla letras de distintos alfabetos que se ven iguales, una técnica para imitar nombres conocidos.',
    }
    expect(signalTextFor(hit)).toBe(RULE_SIGNAL_TEXTS['punycode-deceptive'])
  })

  it('las demás reglas usan su frase de siempre', () => {
    const hit = {
      id: 'at-symbol' as const,
      weight: 30,
      explanation: 'x para imitar a "paypal.com"',
    }
    expect(signalTextFor(hit)).toBe(RULE_SIGNAL_TEXTS['at-symbol'])
  })
})

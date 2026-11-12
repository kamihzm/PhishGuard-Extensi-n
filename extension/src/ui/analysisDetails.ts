import { ML_WEIGHT, RULE_WEIGHT } from '../agent/combine'
import type { Decision } from '../agent/types'
import { extractFeatures } from '../features/extractFeatures'
import { FEATURE_ORDER, featuresToVector } from '../ml/vectorize'
import { buildHumanExplanation, RISK_LEVEL_LABELS } from './humanExplanation'
import { buildLegendItems } from './riskLegend'
import { RULE_TECHNICAL_LABELS } from './ruleLabels'

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

/**
 * "Ver detalles técnicos": todo lo que no hace falta para decidir qué hacer.
 * La puntuación, los rangos de cada nivel, cómo se llegó al nivel, las
 * reglas con su nombre técnico, el modelo y sus variables. Se usa en el
 * popup y en la página de advertencia. Solo muestra el `Decision` ya
 * calculado; los rangos salen de los umbrales reales de `agent/combine.ts`.
 */
export function buildAnalysisDetails(decision: Decision): HTMLElement {
  const human = buildHumanExplanation(decision)
  const details = el('details', 'tech-details')
  details.appendChild(el('summary', 'tech-summary', 'Ver detalles técnicos'))

  const body = el('div', 'tech-body')
  body.appendChild(
    el(
      'p',
      'analysis-result',
      `Puntuación: ${decision.finalScore} de 100 · ${RISK_LEVEL_LABELS[decision.riskLevel]}`,
    ),
  )
  const legend = el('p', 'legend')
  legend.textContent = buildLegendItems()
    .map((item) => `${item.label}: ${item.range}`)
    .join(' · ')
  body.appendChild(legend)

  body.appendChild(el('h3', 'tech-heading', 'Cómo se decidió'))
  const reasoning = el('ul', 'analysis-findings')
  for (const line of human.reasoning) reasoning.appendChild(el('li', undefined, line))
  body.appendChild(reasoning)

  body.appendChild(buildAdvancedBody(decision))
  details.appendChild(body)
  return details
}

function buildAdvancedBody(decision: Decision): HTMLElement {
  const body = el('div', 'advanced-body')

  body.appendChild(el('h3', 'tech-heading', 'Sistema experto'))
  body.appendChild(el('p', 'tech-row', `Puntuación de reglas: ${decision.ruleScore}/100`))
  if (decision.activatedRules.length === 0) {
    body.appendChild(el('p', 'tech-row', 'Reglas activadas: ninguna.'))
  } else {
    const list = el('ul', 'tech-rule-list')
    for (const hit of decision.activatedRules) {
      const item = document.createElement('li')
      item.appendChild(el('strong', undefined, `${RULE_TECHNICAL_LABELS[hit.id]} (+${hit.weight})`))
      item.appendChild(document.createTextNode(`: ${hit.explanation}`))
      list.appendChild(item)
    }
    body.appendChild(list)
  }

  body.appendChild(el('h3', 'tech-heading', 'Análisis automático'))
  body.appendChild(el('p', 'tech-row', 'Modelo: Random Forest (100 árboles, calibrado)'))
  body.appendChild(
    el(
      'p',
      'tech-row advanced-model-score',
      decision.mlSkippedReason
        ? `Score del modelo: no aplica (${decision.mlSkippedReason === 'plataforma' ? 'plataforma de alojamiento' : 'dominio internacional'})`
        : `Score del modelo: ${(decision.mlProbability * 100).toFixed(1)}%`,
    ),
  )
  body.appendChild(
    el(
      'p',
      'advanced-note',
      'Puntaje del modelo, calibrado con datos de validación: es una estimación, no una certeza de que el sitio sea phishing.',
    ),
  )

  body.appendChild(el('h3', 'tech-heading', 'Resultado combinado'))
  body.appendChild(
    el(
      'p',
      'tech-row',
      `Combinación: ${Math.round(RULE_WEIGHT * 100)}% reglas + ${Math.round(ML_WEIGHT * 100)}% modelo (más los pisos por reglas fuertes)`,
    ),
  )
  body.appendChild(
    el('p', 'tech-row advanced-final-score', `Resultado combinado: ${decision.finalScore}/100`),
  )
  body.appendChild(el('p', 'tech-row', `Nivel de riesgo: ${RISK_LEVEL_LABELS[decision.riskLevel]}`))

  const featureList = buildFeatureList(decision.url)
  if (featureList) {
    const features = el('details', 'advanced-details')
    features.appendChild(
      el('summary', 'advanced-summary', 'Ver las variables de entrada del modelo'),
    )
    features.appendChild(featureList)
    body.appendChild(features)
  }
  return body
}

/**
 * Las 16 variables que recibe el modelo, recalculadas con el MISMO
 * extractor determinista de producción solo para mostrarlas (no se usan
 * para decidir nada). Si la URL no se puede analizar, se omite la sección.
 */
function buildFeatureList(url: string): HTMLElement | null {
  let vector: number[]
  try {
    vector = featuresToVector(extractFeatures(url))
  } catch {
    return null
  }
  const list = el('ul', 'advanced-features')
  FEATURE_ORDER.forEach((name, i) => {
    const value = vector[i]!
    list.appendChild(
      el('li', undefined, `${name}: ${Number.isInteger(value) ? value : value.toFixed(3)}`),
    )
  })
  return list
}

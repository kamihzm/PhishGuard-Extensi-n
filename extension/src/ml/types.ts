/** Artefacto entrenado offline por `training/trainLogisticRegression.ts` y empaquetado en build time. */
export interface MlModel {
  featureOrder: string[]
  mean: number[]
  std: number[]
  weights: number[]
  bias: number
  trainedAt: string
  /** Calculadas sobre el split de prueba (test), nunca visto durante entrenamiento ni ajuste de hiperparámetros. */
  metrics: {
    accuracy: number
    precision: number
    recall: number
    f1: number
    confusionMatrix: {
      truePositive: number
      falsePositive: number
      trueNegative: number
      falseNegative: number
    }
  }
}

/** Salida del clasificador ML: probabilidad de phishing (0–1). */
export interface MlResult {
  probability: number
}

/** Nodo de un árbol CART: si `featureIndex`/`threshold` están definidos es un nodo interno, si no es una hoja. */
export interface TreeNode {
  /** Fracción de ejemplos con label=1 en este nodo (predicción si es hoja). */
  probability: number
  featureIndex?: number
  threshold?: number
  left?: TreeNode
  right?: TreeNode
}

/** Artefacto entrenado offline por `training/trainRandomForest.ts` y empaquetado en build time. */
export interface RandomForestArtifact {
  featureOrder: string[]
  /** Umbral de decisión con el que se midieron `metrics` (elegido tras comparar modelos, ver docs/model-comparison.md). */
  threshold: number
  trees: TreeNode[]
  /**
   * Calibración opcional (2026-10-01, `training/calibrateForest.ts`): escalado
   * de Platt, p_cal = σ(a · logit(clip(p, epsilon)) + b), ajustado SOLO en
   * validación, para que la probabilidad tenga la escala que espera
   * `agent/combine.ts` (la de la regresión logística). Con calibración,
   * `threshold` se expresa sobre la probabilidad calibrada.
   */
  calibration?: {
    method: 'platt'
    a: number
    b: number
    epsilon: number
    fittedOn: string
    /** Umbral original del bosque sin calibrar. */
    rawThreshold: number
  }
  trainedAt: string
  metrics: {
    accuracy: number
    precision: number
    recall: number
    f1: number
    confusionMatrix: {
      truePositive: number
      falsePositive: number
      trueNegative: number
      falseNegative: number
    }
  }
}

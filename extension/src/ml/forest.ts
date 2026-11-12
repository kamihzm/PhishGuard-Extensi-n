import type { FeatureSet } from '../features/types'
import forestModel from './forestModel.json'
import type { MlResult, RandomForestArtifact, TreeNode } from './types'
import { featuresToVector } from './vectorize'

const MODEL = forestModel as RandomForestArtifact

/**
 * Recorre un árbol: en cada nodo interno compara la feature contra su
 * umbral y sigue a la izquierda o la derecha, hasta llegar a una hoja. Es la
 * ÚNICA implementación de este recorrido — tanto el runtime (aquí) como
 * `training/decisionTree.ts` y `training/randomForest.ts` (offline, para
 * medir accuracy durante el entrenamiento) la importan desde este archivo,
 * para no repetir el error de train/serve skew que ya se evitó en
 * `features/` y `vectorize.ts`.
 */
export function predictTreeProbability(node: TreeNode, vector: number[]): number {
  if (node.featureIndex === undefined || node.threshold === undefined) return node.probability
  return vector[node.featureIndex]! <= node.threshold
    ? predictTreeProbability(node.left!, vector)
    : predictTreeProbability(node.right!, vector)
}

/** Voto suave: promedio de la probabilidad que da cada árbol del ensamble. */
export function predictForestProbability(trees: TreeNode[], vector: number[]): number {
  const sum = trees.reduce((total, tree) => total + predictTreeProbability(tree, vector), 0)
  return sum / trees.length
}

/** Aplica la calibración del artefacto (si la tiene) a la probabilidad cruda del bosque. */
export function calibrateForestProbability(
  probability: number,
  artifact: RandomForestArtifact,
): number {
  const c = artifact.calibration
  if (!c) return probability
  const q = Math.min(1 - c.epsilon, Math.max(c.epsilon, probability))
  return 1 / (1 + Math.exp(-(c.a * Math.log(q / (1 - q)) + c.b)))
}

/**
 * Inferencia con el Random Forest ya entrenado y empaquetado
 * (`forestModel.json`), con su calibración (Platt, ajustada solo en
 * validación) para que la probabilidad tenga la escala que espera
 * `agent/combine.ts`. Es el componente ML de `decide()` desde la adopción
 * del RF v4-propio (ver `docs/rf-adoption.md`). Nunca reentrena.
 */
export function classify(features: FeatureSet): MlResult {
  const vector = featuresToVector(features)
  return {
    probability: calibrateForestProbability(predictForestProbability(MODEL.trees, vector), MODEL),
  }
}

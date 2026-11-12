import type { FeatureSet } from '../features/types'
import model from './model.json'
import type { MlModel, MlResult } from './types'
import { featuresToVector } from './vectorize'

const MODEL = model as MlModel

/**
 * Inferencia: estandarizar → producto punto → sigmoide. El entrenamiento
 * (media/desviación estándar, pesos, bias) vive en `training/`; aquí solo se
 * aplica el modelo ya entrenado, sin ningún cálculo de aprendizaje.
 */
export function classify(features: FeatureSet): MlResult {
  return classifyWithModel(features, MODEL)
}

/** Variante parametrizada por modelo, para poder probar la matemática con un modelo de juguete determinista. */
export function classifyWithModel(features: FeatureSet, model: MlModel): MlResult {
  const vector = featuresToVector(features)

  const z = vector.reduce((sum, value, i) => {
    const standardized = (value - model.mean[i]!) / (model.std[i] || 1)
    return sum + standardized * model.weights[i]!
  }, model.bias)

  return { probability: sigmoid(z) }
}

function sigmoid(z: number): number {
  return 1 / (1 + Math.exp(-z))
}

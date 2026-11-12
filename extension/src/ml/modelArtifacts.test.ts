import { describe, expect, it } from 'vitest'
import forestModel from './forestModel.json'
import realModel from './model.json'
import type { MlModel, RandomForestArtifact, TreeNode } from './types'
import { FEATURE_ORDER } from './vectorize'

/**
 * Los artefactos entrenados deben leer el vector en el MISMO orden que
 * `featuresToVector` (`FEATURE_ORDER`). Si no, cada peso o nodo lee una
 * feature distinta de la que aprendió, sin ningún error en tiempo de
 * ejecución: le pasó a `forestModel.json`, entrenado con 11 features en el
 * orden antiguo y evaluado con vectores de 16 (corregido el 2026-10-01).
 */
describe('artefactos de ML coherentes con FEATURE_ORDER', () => {
  const forest = forestModel as RandomForestArtifact
  const logistic = realModel as MlModel

  it('forestModel.json declara el mismo número y orden de features que FEATURE_ORDER', () => {
    expect(forest.featureOrder).toEqual([...FEATURE_ORDER])
  })

  it('ningún nodo de forestModel.json usa un índice de feature fuera de FEATURE_ORDER', () => {
    const invalid: number[] = []
    const walk = (node: TreeNode): void => {
      if (node.featureIndex === undefined) return
      if (
        !Number.isInteger(node.featureIndex) ||
        node.featureIndex < 0 ||
        node.featureIndex >= FEATURE_ORDER.length
      ) {
        invalid.push(node.featureIndex)
      }
      if (node.left) walk(node.left)
      if (node.right) walk(node.right)
    }
    forest.trees.forEach(walk)
    expect(forest.trees.length).toBeGreaterThan(0)
    expect(invalid).toEqual([])
  })

  it('model.json declara el mismo número y orden de features que FEATURE_ORDER', () => {
    expect(logistic.featureOrder).toEqual([...FEATURE_ORDER])
  })

  it('model.json tiene un peso, una media y una desviación por feature', () => {
    expect(logistic.weights).toHaveLength(FEATURE_ORDER.length)
    expect(logistic.mean).toHaveLength(FEATURE_ORDER.length)
    expect(logistic.std).toHaveLength(FEATURE_ORDER.length)
  })
})

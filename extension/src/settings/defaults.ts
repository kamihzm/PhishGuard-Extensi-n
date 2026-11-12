import type { Settings } from './types'

/**
 * Valores por defecto. La IA (rules/, ml/, agent/combine.ts) no lee nada de
 * acá — estas preferencias controlan comportamiento del producto (si se
 * bloquea, si se guarda, si se muestra el badge), nunca la clasificación.
 */
export const DEFAULT_SETTINGS: Settings = {
  phishingProtectionEnabled: true,
  highRiskWarningEnabled: true,
  saveHistoryEnabled: true,
  showBadgeEnabled: true,
  // Apagado: un usuario normal ve solo el análisis en palabras simples.
  advancedModeEnabled: false,
}

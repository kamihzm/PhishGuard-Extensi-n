/**
 * Límites de cuota de `chrome.declarativeNetRequest` y presupuesto del Core
 * de Web Protection (Fase C, docs/web-protection-audit.md).
 *
 * Los valores de Chrome se verificaron en Chrome for Testing 154 leyendo
 * las constantes de la propia API (`GUARANTEED_MINIMUM_STATIC_RULES`,
 * `MAX_NUMBER_OF_STATIC_RULESETS`, `MAX_NUMBER_OF_ENABLED_STATIC_RULESETS`).
 */

/** Reglas estáticas que Chrome garantiza a cada extensión, haya o no cuota global libre. */
export const GUARANTEED_MINIMUM_STATIC_RULES = 30_000

/** Rulesets estáticos que puede declarar el manifest. */
export const MAX_NUMBER_OF_STATIC_RULESETS = 100

/** Rulesets estáticos habilitados a la vez. */
export const MAX_NUMBER_OF_ENABLED_STATIC_RULESETS = 50

/**
 * Parte del mínimo garantizado que Web Protection reserva para futuras
 * reglas estáticas que también deben funcionar siempre (amenazas
 * conocidas y strict block, Fases E y F). El Core de anuncios +
 * rastreadores nunca usa esta reserva.
 */
export const RESERVED_GUARANTEED_RULES = 5_000

/** Máximo de reglas (bloqueos + excepciones) del Core de anuncios + rastreadores. */
export const CORE_RULE_BUDGET = GUARANTEED_MINIMUM_STATIC_RULES - RESERVED_GUARANTEED_RULES

/** Tamaño máximo de cada ruleset opcional: pequeño para aprovechar la cuota libre con granularidad fina. */
export const OPTIONAL_CHUNK_SIZE = 5_000

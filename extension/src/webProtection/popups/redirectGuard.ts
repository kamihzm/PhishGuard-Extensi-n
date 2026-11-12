import { acceptIntentRecord, parseIntentRecord } from './intentRecord'
import { classifyRedirect } from './popupClassifier'
import { MAX_CHAIN, type NavigationContext, type PopupState } from './popupState'
import type { AdEvidence, UserIntent } from './types'

/**
 * Redirecciones publicitarias de la PESTAÑA ORIGINAL (p. ej. la página
 * navega sola a un anunciante en lugar de al destino que pidió el usuario).
 *
 * - En `onBeforeNavigate` (el documento anterior aún existe) se consulta la
 *   intención reciente del usuario en esa pestaña. Si el service worker se
 *   reinició y el documento ya no existe, se usa el registro persistido por
 *   el content script (`intentRecord.ts`) o no se actúa.
 * - Se acumulan los saltos (redirecciones de servidor vía `webRequest`).
 * - En `onCommitted` se clasifica. SOLO CONFIRMED_REDIRECT_AD provoca una
 *   acción: volver atrás una vez (`tabs.goBack`), con enfriamiento por
 *   pestaña para evitar bucles. Nunca se revierten navegaciones escritas,
 *   recargas, atrás/adelante, formularios ni destinos de login o pago.
 */
/** Lo mínimo de `chrome.tabs.Tab` que necesita el respaldo de `lastUrl`. */
export interface TabSnapshot {
  url?: string
  pendingUrl?: string
}

export interface RedirectGuardDeps {
  state: PopupState
  queryIntents(tabId: number): Promise<UserIntent[] | null>
  loadEvidence(): Promise<AdEvidence>
  goBack(tabId: number): Promise<void>
  /** `chrome.tabs.get`; `null` si la pestaña no existe. */
  getTab(tabId: number): Promise<TabSnapshot | null>
  isEnabled(): Promise<boolean>
  /** Lee y elimina el registro de intención persistido de la pestaña (sin validar). */
  takeIntentRecord(tabId: number): Promise<unknown>
  /** Token de correlación de la pestaña (`chrome.storage.session`). */
  getIntentToken(tabId: number): Promise<string | null>
  now(): number
  log(message: string): void
}

const isHttp = (url: string) => /^https?:/i.test(url)

/**
 * Respaldo de `lastUrl` (memoria perdida al reiniciarse el service worker).
 * Medido en Chromium real: durante `onBeforeNavigate`, `tab.url` es aún la
 * página anterior y `tab.pendingUrl` el destino en curso (también a través de
 * redirecciones 3xx); tras `onCommitted`, `pendingUrl` desaparece. Sin
 * navegación pendiente no se adivina: `tab.url` podría ser ya el destino.
 */
export function previousUrlFromTab(tab: TabSnapshot | null): string | null {
  if (!tab?.pendingUrl || !tab.url || !isHttp(tab.url)) return null
  return tab.url
}

export function createRedirectGuard(deps: RedirectGuardDeps) {
  const { state } = deps
  return {
    /**
     * Registro SÍNCRONO: tras un arranque en frío, `onCommitted` puede llegar
     * antes de que termine cualquier espera; el contexto se fija aquí.
     */
    onBeforeNavigate(tabId: number, url: string, timeStamp: number) {
      if (!isHttp(url)) return
      const known = state.lastUrl.get(tabId)
      const context: Promise<NavigationContext> =
        known !== undefined
          ? Promise.resolve({ previousUrl: known, liveDocument: true })
          : deps
              .getTab(tabId)
              .then(previousUrlFromTab)
              .catch(() => null)
              .then((previousUrl) => ({ previousUrl, liveDocument: previousUrl !== null }))
      const enabled = deps.isEnabled().catch(() => false)
      state.navigations.set(tabId, {
        tabId,
        context,
        enabled,
        startedAt: timeStamp,
        chain: [url],
        intents: enabled.then((on) => (on ? deps.queryIntents(tabId).catch(() => null) : null)),
      })
    },
    onMainFrameRequest(tabId: number, url: string) {
      const nav = state.navigations.get(tabId)
      if (nav && nav.chain.length < MAX_CHAIN && nav.chain[nav.chain.length - 1] !== url)
        nav.chain.push(url)
    },
    async onCommitted(
      tabId: number,
      url: string,
      transitionType: string,
      transitionQualifiers: string[],
    ): Promise<void> {
      const nav = state.navigations.get(tabId)
      state.navigations.delete(tabId)
      if (!nav) return
      if (nav.chain[nav.chain.length - 1] !== url) nav.chain.push(url)
      // Consumo único: el registro persistido de esta pestaña se retira siempre.
      const persisted = deps.takeIntentRecord(tabId).catch(() => null)
      const [enabled, context, queried, evidence] = await Promise.all([
        nav.enabled,
        nav.context,
        nav.intents,
        deps.loadEvidence(),
      ])
      if (!enabled) return
      const record = parseIntentRecord(await persisted)
      const token = record ? await deps.getIntentToken(tabId).catch(() => null) : null
      const accepted = record
        ? acceptIntentRecord(record, { token, navigationStartedAt: nav.startedAt })
        : null
      let { previousUrl } = context
      let intents = queried
      if (!context.liveDocument) {
        // Arranque en frío: el documento original ya no existe. La consulta la
        // respondió el documento NUEVO, así que solo vale el registro persistido.
        if (!accepted) return // falta información o la correlación es dudosa: no se adivina
        previousUrl = accepted.documentUrl
        intents = [accepted.intent]
      } else if (accepted) {
        // Worker vivo: en navegaciones rápidas la consulta puede llegar vacía
        // (la responde el documento nuevo) o no llegar; el registro la completa.
        intents = [...(queried ?? []), accepted.intent]
      }
      if (!previousUrl) return // sin página anterior conocida no se evalúa
      const result = classifyRedirect({
        previousUrl,
        chain: nav.chain,
        transitionType,
        transitionQualifiers,
        intents,
        startedAt: nav.startedAt,
        evidence,
      })
      if (result.verdict === 'SUSPICIOUS') {
        deps.log(`[WebProtection] redirección SUSPICIOUS (permitida): ${result.signals.join(',')}`)
      }
      if (result.verdict !== 'CONFIRMED_REDIRECT_AD') return
      const now = deps.now()
      if (!state.canAct(tabId, now)) return
      state.recordAction(tabId, now)
      deps.log(
        `[WebProtection] redirección CONFIRMED_REDIRECT_AD → atrás: ${result.signals.join(',')}`,
      )
      await deps.goBack(tabId).catch(() => undefined)
    },
  }
}

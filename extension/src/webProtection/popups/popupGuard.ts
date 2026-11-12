import {
  classifyPopup,
  INTERACTION_WINDOW_MS,
  isPendingCandidate,
  isTinySize,
  type WindowBounds,
} from './popupClassifier'
import {
  createPopupState,
  MAX_CHAIN,
  OBSERVATION_TTL_MS,
  POPUP_PENDING_TTL_MS,
  type HoldResult,
  type PopupObservation,
  type PopupState,
  type PopupWindowGeometry,
} from './popupState'
import { siteOf } from './navigationIntent'
import { createRedirectGuard, type TabSnapshot } from './redirectGuard'
import type { AdEvidence, HopRecord, UserIntent } from './types'

/**
 * Popup Guard: ventanas/pestañas abiertas por una página
 * (`webNavigation.onCreatedNavigationTarget`) y redirecciones de la pestaña
 * original (`redirectGuard.ts`).
 *
 * Solo actúa con "Anuncios" activo y solo ante CONFIRMED_*:
 * - CONFIRMED_POPUP_AD → `tabs.remove` de ESA pestaña nueva (nunca de la
 *   pestaña de origen, nunca de una pestaña abierta por el usuario);
 * - SUSPICIOUS / LEGITIMATE → no se hace nada.
 *
 * POPUP_PENDING: una ventana no solicitada, abierta justo tras un clic, hacia
 * otro sitio y distinta del destino pedido, queda en espera acotada
 * (`POPUP_PENDING_TTL_MS`) mientras su cadena de redirecciones revela
 * evidencia. Durante ese intervalo, `hold(tabId)` permite a un coordinador
 * EXTERNO (background) diferir la ejecución de acciones de otros
 * subsistemas sobre esa pestaña. Web Protection no conoce esos subsistemas.
 *
 * Los registros contienen solo veredictos y señales, nunca URLs.
 */
export interface PopupGuardDeps {
  isEnabled(): Promise<boolean>
  queryIntents(tabId: number): Promise<UserIntent[] | null>
  getTabUrl(tabId: number): Promise<string | null>
  getTab(tabId: number): Promise<TabSnapshot | null>
  /** Área de contenido ACTUAL de la pestaña (`tabs.get`); `null` si no se pudo leer. */
  getTabSize(tabId: number): Promise<{ width: number; height: number } | null>
  /** URL del marco `frameId` de la pestaña (`webNavigation.getFrame`); `null` si ya no existe. */
  getFrameUrl(tabId: number, frameId: number): Promise<string | null>
  /** Lee y elimina el registro de intención persistido (`intentRecord.ts`). */
  takeIntentRecord(tabId: number): Promise<unknown>
  getIntentToken(tabId: number): Promise<string | null>
  loadEvidence(): Promise<AdEvidence>
  closeTab(tabId: number): Promise<void>
  goBack(tabId: number): Promise<void>
  now(): number
  /** Programa `fn` tras `ms`; devuelve la cancelación. */
  schedule(fn: () => void, ms: number): () => void
  log(message: string): void
}

export interface CreatedTargetDetails {
  sourceTabId: number
  sourceFrameId: number
  tabId: number
  url: string
  timeStamp: number
}

/**
 * `tabs.onCreated` de una pestaña con opener: con el experimento
 * `popupGuardTabCreated` (cualquier pestaña) o, sin él, solo si vive en una
 * ventana `type: popup` (T6, `origin: 'popup-window'`).
 */
export interface TabCreatedDetails {
  tabId: number
  openerTabId: number
  /** `pendingUrl`/`url` de la pestaña: suele ser vacío o `about:blank`. */
  url: string
  timeStamp: number
  /** Qué camino la entrega; por defecto el experimento (`tab-created`). */
  origin?: 'tab-created' | 'popup-window'
  /** Ventana `type: popup` que la contiene, con su tamaño al crearse. */
  window?: PopupWindowGeometry
}

const isHttp = (url: string) => /^https?:/i.test(url)
/** `about:blank`, también con consulta o fragmento (`about:blank#x`). */
const ABOUT_BLANK = /^about:blank(?:[?#]|$)/i
/** Marca en los registros las ventanas que no llegaron por `onCreatedNavigationTarget`. */
const originTag = (obs: PopupObservation) =>
  obs.origin === 'tab-created'
    ? ' [origen: tabs.onCreated]'
    : obs.origin === 'popup-window'
      ? ' [origen: ventana popup]'
      : ''

const boundsText = (b: WindowBounds | undefined) =>
  b ? `${b.left},${b.top},${b.width}x${b.height}` : '?'
/** T8: geometría usada para los bordes y demora de su medición (solo números). */
const geometryTag = (obs: PopupObservation) => {
  const m = obs.window?.measure
  return m
    ? ` | geometría popup=${boundsText(m.popup)} opener=${boundsText(m.opener)} fuente=${m.source} medida_ms=${m.delayMs}`
    : ''
}

/** Por qué no se confirmó: condiciones de `popunder-window` que fallaron (T7), comportamiento y geometría (T8). */
const detailTag = (obs: PopupObservation) =>
  (obs.lastPopunderMiss ? ` | popunder no confirmado: ${obs.lastPopunderMiss}` : '') +
  (obs.lastBehavior ? ` | ${obs.lastBehavior}` : '') +
  geometryTag(obs)

export function createPopupGuard(deps: PopupGuardDeps, state: PopupState = createPopupState()) {
  const redirects = createRedirectGuard({
    state,
    queryIntents: deps.queryIntents,
    loadEvidence: deps.loadEvidence,
    goBack: deps.goBack,
    getTab: deps.getTab,
    isEnabled: deps.isEnabled,
    takeIntentRecord: deps.takeIntentRecord,
    getIntentToken: deps.getIntentToken,
    now: deps.now,
    log: deps.log,
  })

  const settle = (obs: PopupObservation, hold: 'handled' | 'released') => {
    if (obs.hold === 'handled' || obs.hold === 'released') return
    obs.hold = hold
    obs.cancelTimer?.()
    obs.cancelTimer = undefined
    const result: HoldResult = hold === 'handled' ? 'handled-by-web-protection' : 'release'
    for (const resolve of obs.waiters.splice(0)) resolve(result)
  }

  /** Pestañas con `closeTab` en curso: su resultado decide la retención. */
  const closing = new Set<number>()

  const evaluate = async (obs: PopupObservation) => {
    if (obs.decided || obs.intents === undefined) return
    const evidence = await deps.loadEvidence()
    // Descartada mientras se esperaba la lista (vencida o pestaña cerrada): ya se
    // liberó para el coordinador; actuar ahora sería una segunda acción.
    if (obs.decided || state.observations.get(obs.tabId) !== obs) return
    const input = {
      sourceUrl: obs.sourceUrl,
      chain: obs.chain,
      createdAt: obs.createdAt,
      intents: obs.intents,
      siblings: obs.siblings,
      evidence,
      hops: obs.hops,
      ...(obs.window
        ? { window: { ...obs.window, bornBlank: state.bornBlank.get(obs.tabId) === true } }
        : {}),
    }
    let result = classifyPopup(input)
    obs.lastPopunderMiss = result.popunderMiss?.join(',')
    if (result.verdict === 'CONFIRMED_POPUP_AD' && result.signals.includes('popunder-window')) {
      // T6: el tamaño se leyó al crearse. Una página legítima puede abrir chica
      // y agrandarse antes de navegar; por eso se exige que siga diminuta o que
      // haya nacido pegada al borde de la ventana que la abrió (el popunder real
      // de animeyt nace fuera de la vista y se agranda justo antes de navegar).
      // Sin lectura: no se actúa.
      // Si se sabe qué iframe la abrió y es de OTRO sitio (widget de un tercero,
      // cuyo clic no se registra), no se confirma por la técnica; si ya no se
      // puede leer, tampoco (fail-open).
      const frameId = obs.sourceFrameId ?? -1
      const [size, frameUrl] = await Promise.all([
        deps.getTabSize(obs.tabId).catch(() => null),
        frameId > 0
          ? deps.getFrameUrl(obs.sourceTabId, frameId).catch(() => null)
          : Promise.resolve('about:blank'),
      ])
      if (obs.decided || state.observations.get(obs.tabId) !== obs) return
      const thirdPartyFrame =
        frameUrl === null || (isHttp(frameUrl) && siteOf(frameUrl) !== siteOf(obs.sourceUrl))
      // T8: nacida pegada al borde derecho/inferior DENTRO de la pantalla
      // (`atFarEdge`, la misma banda que levanta el veto del control) también
      // cuenta como nacida en el borde: el popunder real nace así y ya creció.
      const bornAtEdge = obs.window?.atEdge === true || obs.window?.atFarEdge === true
      const stillHidden = size !== null && (isTinySize(size.width, size.height) || bornAtEdge)
      if (!stillHidden || thirdPartyFrame) {
        obs.lastBehavior = thirdPartyFrame
          ? 'popunder: abierta desde un iframe de otro sitio o ya inexistente'
          : 'popunder: la ventana creció sin haber nacido en el borde o no se pudo releer'
        result = {
          verdict: 'SUSPICIOUS',
          signals: result.signals.filter((s) => s !== 'popunder-window'),
        }
      }
    }
    if (result.behavior) {
      const b = result.behavior
      obs.lastBehavior = b.failedGate
        ? `comportamiento: compuerta ${b.failedGate}`
        : `comportamiento ${b.score}/3 [${b.signals.join(',')}] redirecciones=${b.redirects} dominios=${b.distinctSites}`
    }
    if (result.verdict === 'CONFIRMED_POPUP_AD') {
      const now = deps.now()
      if (!state.canAct(obs.tabId, now)) return
      obs.decided = true
      state.recordAction(obs.tabId, now)
      deps.log(
        `[WebProtection] ventana CONFIRMED_POPUP_AD → cerrando: ${result.signals.join(',')}${geometryTag(obs)}${originTag(obs)}`,
      )
      // `handled` solo con la pestaña realmente cerrada: si el cierre falla, se
      // libera para que el coordinador ejecute la acción del otro subsistema.
      // El TTL de POPUP_PENDING no debe decidir mientras el cierre está en curso.
      obs.cancelTimer?.()
      obs.cancelTimer = undefined
      closing.add(obs.tabId)
      try {
        await deps.closeTab(obs.tabId)
        deps.log(`[WebProtection] ventana CONFIRMED_POPUP_AD → cerrada${originTag(obs)}`)
        settle(obs, 'handled')
      } catch {
        deps.log(
          `[WebProtection] ventana CONFIRMED_POPUP_AD → no se pudo cerrar (se libera)${originTag(obs)}`,
        )
        settle(obs, 'released')
      } finally {
        closing.delete(obs.tabId)
      }
      return
    }
    if (
      obs.hold === 'pending' &&
      obs.chain.length > 0 &&
      (result.verdict === 'LEGITIMATE' || result.signals.includes('sensitive-destination'))
    ) {
      settle(obs, 'released') // resultó legítima o sensible: no se retiene más
    }
    if (obs.hold === 'evaluating') {
      if (isPendingCandidate(result, input)) {
        obs.hold = 'pending'
        deps.log(
          `[WebProtection] ventana POPUP_PENDING: ${result.signals.join(',')}${originTag(obs)}`,
        )
        obs.cancelTimer = deps.schedule(() => {
          if (obs.hold === 'pending') {
            deps.log(
              `[WebProtection] ventana SUSPICIOUS (permitida): TTL de POPUP_PENDING vencido${detailTag(obs)}${originTag(obs)}`,
            )
          }
          settle(obs, 'released')
        }, POPUP_PENDING_TTL_MS)
      } else {
        settle(obs, 'released')
      }
    }
    if (
      result.verdict === 'SUSPICIOUS' &&
      obs.lastVerdict !== result.verdict &&
      obs.hold !== 'pending'
    ) {
      deps.log(
        `[WebProtection] ventana SUSPICIOUS (permitida): ${result.signals.join(',')}${detailTag(obs)}${originTag(obs)}`,
      )
    }
    obs.lastVerdict = result.verdict
  }

  const pushToObservation = (
    tabId: number,
    url: string,
    via: HopRecord['via'],
    at: number,
    status?: number,
  ) => {
    const obs = state.observations.get(tabId)
    if (!obs || obs.decided || !isHttp(url)) return false
    // Observación vencida (P2): ya no decide nada. Se compara la hora del evento
    // con `createdAt` (sin temporizadores); la pestaña pasa a tratarse como
    // cualquier otra y el evento sigue su camino normal (Redirect Guard).
    if (at - obs.createdAt > OBSERVATION_TTL_MS) {
      drop(tabId)
      return false
    }
    if (obs.chain.length < MAX_CHAIN && obs.chain[obs.chain.length - 1] !== url) obs.chain.push(url)
    // Misma URL por el mismo canal: evento duplicado, no es un salto nuevo.
    if (obs.hops.length < MAX_CHAIN * 3 && !obs.hops.some((h) => h.url === url && h.via === via)) {
      obs.hops.push({ url, via, at, ...(status !== undefined ? { status } : {}) })
    }
    void evaluate(obs)
    return true
  }

  const drop = (tabId: number) => {
    const obs = state.observations.get(tabId)
    // `onRemoved` del propio cierre puede llegar antes de que `closeTab` resuelva.
    if (obs && !closing.has(tabId)) settle(obs, 'released')
    state.observations.delete(tabId)
  }

  /** Registra una ventana nueva; `origin` indica qué evento la vio primero. */
  const register = (
    details: CreatedTargetDetails,
    origin: NonNullable<PopupObservation['origin']>,
    window?: PopupWindowGeometry,
  ): Promise<void> => {
    const now = deps.now()
    for (const [id, o] of state.observations) {
      if (now - o.createdAt > 10_000) drop(id) // estado viejo: libera y olvida
    }
    state.prune(now)
    // Registro SÍNCRONO: el coordinador debe poder verla aunque consulte de inmediato.
    const obs: PopupObservation = {
      origin,
      tabId: details.tabId,
      sourceTabId: details.sourceTabId,
      sourceFrameId: details.sourceFrameId,
      sourceUrl: '',
      createdAt: details.timeStamp,
      chain: isHttp(details.url) ? [details.url] : [],
      hops: isHttp(details.url)
        ? [{ url: details.url, via: 'initial', at: details.timeStamp }]
        : [],
      intents: undefined,
      siblings: state.siblingsOf(details.sourceTabId, details.timeStamp, INTERACTION_WINDOW_MS),
      ...(window ? { window } : {}),
      decided: false,
      hold: 'evaluating',
      waiters: [],
    }
    state.observations.set(details.tabId, obs)
    return (async () => {
      try {
        if (!(await deps.isEnabled())) return drop(details.tabId)
        const sourceUrl =
          state.lastUrl.get(details.sourceTabId) ?? (await deps.getTabUrl(details.sourceTabId))
        if (!sourceUrl || !isHttp(sourceUrl)) return drop(details.tabId)
        obs.sourceUrl = sourceUrl
        obs.intents = await deps.queryIntents(details.sourceTabId).catch(() => null)
        await evaluate(obs)
      } catch {
        // Fail-open: ante cualquier error, no se retiene nada.
        settle(obs, 'released')
      }
    })()
  }

  return {
    state,
    /**
     * Para el coordinador de acciones: `null` si Web Protection no está
     * observando esa pestaña; si la observa, una promesa que resuelve
     * `handled-by-web-protection` (ventana confirmada y cerrada) o `release`.
     */
    hold(tabId: number): Promise<HoldResult> | null {
      const obs = state.observations.get(tabId)
      if (!obs) return null
      if (obs.hold === 'handled') return Promise.resolve('handled-by-web-protection')
      if (obs.hold === 'released') return Promise.resolve('release')
      return new Promise((resolve) => obs.waiters.push(resolve))
    },
    onCreatedNavigationTarget(details: CreatedTargetDetails): Promise<void> {
      const existing = state.observations.get(details.tabId)
      if (existing) {
        // Ya observada desde `tabs.onCreated` (experimento o ventana popup): se suman
        // el marco que la abrió y su destino inicial.
        if (existing.origin !== 'navigation-target' && (existing.sourceFrameId ?? -1) < 0) {
          existing.sourceFrameId = details.sourceFrameId
        }
        if (existing.origin !== 'navigation-target' && isHttp(details.url)) {
          pushToObservation(details.tabId, details.url, 'initial', details.timeStamp)
        }
        return Promise.resolve() // evento duplicado
      }
      return register(details, 'navigation-target')
    },
    /**
     * Pestaña nueva con opener vista por `tabs.onCreated`: con el EXPERIMENTO
     * `popupGuardTabCreated` (desactivado por defecto) cualquiera; sin él, solo
     * las de una ventana `type: popup` (T6). Cubre las ventanas que Chrome abre
     * sin `onCreatedNavigationTarget` (popunder que abre `about:blank` desde un
     * iframe oculto y luego la navega). La clasificación es la misma; la
     * geometría de la ventana solo añade la regla del popunder (`classifyPopup`).
     */
    onTabCreated(details: TabCreatedDetails): Promise<void> {
      const existing = state.observations.get(details.tabId)
      if (existing) {
        // `onCreatedNavigationTarget` llegó antes: se le suma el tamaño de la ventana,
        // salvo que ya esté decidida o vencida (P2: una observación vieja no decide nada).
        if (
          details.window &&
          !existing.window &&
          !existing.decided &&
          deps.now() - existing.createdAt <= OBSERVATION_TTL_MS
        ) {
          existing.window = details.window
          void evaluate(existing)
        }
        return Promise.resolve()
      }
      return register(
        {
          sourceTabId: details.openerTabId,
          sourceFrameId: -1,
          tabId: details.tabId,
          url: details.url,
          timeStamp: details.timeStamp,
        },
        details.origin ?? 'tab-created',
        details.window,
      )
    },
    /** `webRequest.onBeforeRequest` de tipo main_frame: incluye saltos de redirección de servidor. */
    onMainFrameRequest(tabId: number, url: string) {
      if (pushToObservation(tabId, url, 'request', deps.now())) return
      redirects.onMainFrameRequest(tabId, url)
    },
    /** `webRequest.onBeforeRedirect` (main_frame, solo observación): destino de una redirección 3xx. */
    onServerRedirect(tabId: number, toUrl: string, statusCode: number) {
      pushToObservation(tabId, toUrl, 'server-redirect', deps.now(), statusCode)
    },
    async onBeforeNavigate(tabId: number, frameId: number, url: string, timeStamp: number) {
      if (frameId !== 0) return
      if (pushToObservation(tabId, url, 'navigation', timeStamp)) return
      // Sin `await` antes de registrar: "Anuncios" se comprueba al decidir.
      redirects.onBeforeNavigate(tabId, url, timeStamp)
    },
    async onCommitted(
      tabId: number,
      frameId: number,
      url: string,
      transitionType: string,
      transitionQualifiers: string[],
    ) {
      if (frameId !== 0) return
      if (!state.bornBlank.has(tabId)) state.bornBlank.set(tabId, ABOUT_BLANK.test(url))
      const observed = pushToObservation(tabId, url, 'commit', deps.now())
      if (isHttp(url)) state.lastUrl.set(tabId, url)
      if (observed) return
      await redirects.onCommitted(tabId, url, transitionType, transitionQualifiers)
    },
    onTabRemoved(tabId: number) {
      drop(tabId)
      state.forget(tabId)
    },
  }
}

/**
 * Tipos del Popup Guard de Web Protection (ventanas emergentes, popunders y
 * redirecciones publicitarias). Independiente del motor de phishing.
 */

/** Resultado de clasificar una ventana nueva o una navegación. */
export type PopupVerdict =
  'LEGITIMATE' | 'SUSPICIOUS' | 'CONFIRMED_POPUP_AD' | 'CONFIRMED_REDIRECT_AD'

/** Interacción reciente del usuario en el marco principal (registrada por el content script). */
export interface UserIntent {
  kind: 'click' | 'auxclick' | 'key' | 'submit'
  /** Epoch ms. */
  at: number
  /** El usuario pidió abrir en pestaña/ventana nueva (Ctrl/Cmd/Shift, clic central, target=_blank). */
  newTab: boolean
  /** Destino que pedía el usuario (href del enlace o action del formulario), solo http(s). */
  expectedUrl: string | null
  form: boolean
  /**
   * T6: el clic fue sobre un control que puede abrir una ventana por sí mismo
   * (botón, `role="button"`, enlace que no navega como `href="#"` o
   * `javascript:`). Solo presente cuando es `true`.
   */
  control?: boolean
}

/** Evidencia de listas autorizadas (EasyList) sobre una URL. */
export interface AdEvidence {
  isAdUrl(url: string): boolean
  isException(url: string): boolean
}

/** Señales que llevaron a un veredicto (solo identificadores; nunca URLs). */
export type PopupSignal =
  | 'intent-unknown'
  | 'user-new-tab-intent'
  | 'matches-expected-destination'
  | 'same-site'
  | 'first-party-redirect'
  | 'no-recent-intent'
  | 'unrequested'
  | 'cross-site'
  | 'list-evidence'
  | 'sensitive-destination'
  | 'multiple-popups'
  | 'user-navigation-type'
  | 'intended-destination'
  | 'redirect-without-intent'
  /** T6: ventana popup diminuta nacida en about:blank (técnica del popunder). */
  | 'popunder-window'

/**
 * Salto de una ventana con su PROCEDENCIA (solo en memoria; nunca se registra la URL):
 * - `initial`: URL con la que se creó la ventana;
 * - `navigation`: inicio de navegación del marco principal (`webNavigation.onBeforeNavigate`);
 * - `server-redirect`: destino de una redirección HTTP 3xx (`webRequest.onBeforeRedirect`);
 * - `commit`: navegación confirmada (`webNavigation.onCommitted`);
 * - `request`: petición `main_frame` vista por `webRequest` sin otra procedencia.
 */
export interface HopRecord {
  url: string
  via: 'initial' | 'navigation' | 'server-redirect' | 'commit' | 'request'
  at: number
  status?: number
}

export interface Classification {
  verdict: PopupVerdict
  signals: PopupSignal[]
  /** Detalle de la evidencia comportamental (solo si se evaluó). */
  behavior?: import('./behaviorEvidence').BehaviorResult
  /**
   * T7: condiciones de la regla `popunder-window` que fallaron en una ventana
   * popup observada (solo diagnóstico para el registro; nunca contiene URLs).
   */
  popunderMiss?: string[]
}

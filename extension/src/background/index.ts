import { isContinueMessage, isNoticeMessage, isTrustMessage } from '../shared/messages'
import { registerWebProtection } from '../webProtection/runtime/registerWebProtection'
import { handleContinueRequest } from './continueNavigation'
import { forgetMediumNoticeTab, handleNoticeMessage } from './mediumNotice'
import { handleTrustRequest } from './trustNavigation'
import { handleNavigation, handleSameDocumentNavigation } from './navigationGate'
import { setActionHoldProvider } from './navigationCoordinator'
import { clearAuthorization } from './navigationAuthorization'
import { forgetBadge, reapplyBadge } from './badge'

// Web Protection (anuncios/rastreadores): subsistema independiente que solo
// habilita o deshabilita rulesets DNR estáticos. No participa en ninguna
// decisión de phishing ni escucha navegaciones.
// El coordinador solo sincroniza la EJECUCIÓN de decisiones independientes:
// si Web Protection está evaluando una ventana recién abierta (POPUP_PENDING),
// la advertencia de phishing sobre esa pestaña espera su decisión (acotada).
setActionHoldProvider(registerWebProtection().popupGuard)

chrome.runtime.onInstalled.addListener(() => {
  console.log('[PhishGuard] service worker instalado y en ejecución')
})

chrome.webNavigation.onBeforeNavigate.addListener((details) => {
  handleNavigation(details).catch((error: unknown) => {
    console.error('[PhishGuard] error evaluando navegación', error)
  })
})

// history.pushState/replaceState: misma página, otra dirección. Solo
// actualiza la insignia y el aviso de nivel medio (ver navigationGate.ts).
// Usa el permiso `webNavigation` que ya existía.
chrome.webNavigation.onHistoryStateUpdated.addListener((details) => {
  handleSameDocumentNavigation(details).catch((error: unknown) => {
    console.error('[PhishGuard] error evaluando navegación en la misma página', error)
  })
})

// Chrome borra la insignia propia de la pestaña al confirmar la navegación,
// después de que `handleNavigation` ya la puso en onBeforeNavigate: se
// vuelve a poner la última guardada (ver badge.ts).
chrome.webNavigation.onCommitted.addListener((details) => {
  if (details.frameId !== 0) return
  reapplyBadge(details.tabId, details.url).catch((error: unknown) => {
    console.error('[PhishGuard] error reponiendo la insignia', error)
  })
})

// La navegación autorizada "terminó" — ya no hace falta conservar la
// autorización más allá de este punto, aunque todavía falten segundos
// para que expire por TTL. También se repone la insignia por si la
// confirmación llegó antes que la decisión.
chrome.webNavigation.onCompleted.addListener((details) => {
  if (details.frameId !== 0) return
  clearAuthorization(details.tabId).catch((error: unknown) => {
    console.error('[PhishGuard] error limpiando autorización', error)
  })
  reapplyBadge(details.tabId, details.url).catch((error: unknown) => {
    console.error('[PhishGuard] error reponiendo la insignia', error)
  })
})

chrome.tabs.onRemoved.addListener((tabId) => {
  forgetBadge(tabId).catch((error: unknown) =>
    console.error('[PhishGuard] error olvidando la insignia', error),
  )
  forgetMediumNoticeTab(tabId).catch((error: unknown) =>
    console.error('[PhishGuard] error limpiando el aviso de nivel medio', error),
  )
})

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (isContinueMessage(message)) {
    // El tabId sale de `sender.tab` (lo entrega Chrome sobre quién mandó el
    // mensaje) — no es un dato que la página tenga que reportar por su cuenta.
    const tabId = sender.tab?.id
    if (tabId === undefined) {
      sendResponse({ ok: false })
      return undefined
    }

    handleContinueRequest(tabId, message.url)
      .then(() => sendResponse({ ok: true }))
      .catch((error: unknown) => {
        console.error('[PhishGuard] error al continuar la navegación', error)
        sendResponse({ ok: false })
      })
    return true // mantiene el canal de mensajes abierto para la respuesta async
  }

  // Aviso de nivel medio dentro de la página: sin URL en el mensaje; todo se
  // valida con `sender` (ver background/mediumNotice.ts).
  if (isNoticeMessage(message)) {
    handleNoticeMessage(message, sender)
      .then(sendResponse)
      .catch((error: unknown) => {
        console.error('[PhishGuard] error atendiendo el aviso de nivel medio', error)
        sendResponse({ ok: false, notice: null })
      })
    return true
  }

  if (isTrustMessage(message)) {
    const tabId = sender.tab?.id
    if (tabId === undefined) {
      sendResponse({ ok: false })
      return undefined
    }

    handleTrustRequest(tabId, message.url)
      .then(() => sendResponse({ ok: true }))
      .catch((error: unknown) => {
        console.error('[PhishGuard] error al confiar en el sitio', error)
        sendResponse({ ok: false })
      })
    return true
  }

  return undefined
})

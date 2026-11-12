import { updateBadge } from '../../background/badge'
import { getSettings } from '../../settings/service'
import { deleteWarningContext, getWarningContext } from '../../shared/warningContextStore'
import { CONTINUE_MESSAGE_TYPE, TRUST_MESSAGE_TYPE } from '../../shared/messages'
import { renderWarning, renderWarningUnavailable } from './renderWarning'
import { goToSafety } from './safeNavigation'

async function main(): Promise<void> {
  const container = document.getElementById('content')
  if (!container) return

  const warningId = new URLSearchParams(location.search).get('id')
  const context = warningId ? await getWarningContext(warningId) : undefined

  if (!warningId || !context) {
    renderWarningUnavailable(container, {
      onCloseTab: () => {
        closeCurrentTab().catch((error: unknown) =>
          console.error('[PhishGuard] error al cerrar la pestaña', error),
        )
      },
      onNewTab: () => {
        openNewTab().catch((error: unknown) =>
          console.error('[PhishGuard] error al abrir una pestaña nueva', error),
        )
      },
    })
    return
  }

  // Único estado mutable de la página — se re-renderiza por completo en
  // cada cambio, igual que el popup hace con sus propios paneles.
  let confirmingTrust = false

  const safeContainer = container
  const safeContext = context
  const safeWarningId = warningId
  // Modo avanzado (Ajustes): si no se puede leer, se usa el modo normal.
  const advanced = await getSettings()
    .then((settings) => settings.advancedModeEnabled)
    .catch(() => false)

  /** `focusSelector`: a qué elemento mover el foco tras dibujar (teclado y lectores de pantalla). */
  function render(focusSelector?: string): void {
    renderWarning(
      safeContainer,
      safeContext.decision,
      { confirmingTrust },
      {
        onGoBack: () => {
          handleGoBack(safeWarningId, safeContext.safeReturnUrl, safeContext.decision.url).catch(
            (error: unknown) => {
              console.error('[PhishGuard] error al volver a un sitio seguro', error)
            },
          )
        },
        onContinueAnyway: () => {
          handleContinueAnyway(safeWarningId, safeContext.decision.url).catch((error: unknown) => {
            console.error('[PhishGuard] error al continuar de todas formas', error)
          })
        },
        onRequestTrust: () => {
          confirmingTrust = true
          render('.trust-confirm-text')
        },
        onCancelTrust: () => {
          confirmingTrust = false
          render('.link-trust')
        },
        onConfirmTrust: () => {
          handleConfirmTrust(safeWarningId, safeContext.decision.url).catch((error: unknown) => {
            console.error('[PhishGuard] error al confiar en el sitio', error)
          })
        },
      },
      { advanced },
    )
    if (focusSelector) safeContainer.querySelector<HTMLElement>(focusSelector)?.focus()
  }

  // La acción principal recibe el foco: Enter vuelve a un sitio seguro.
  render('.btn-safe')

  showHighBadge().catch((error: unknown) =>
    console.error('[PhishGuard] error mostrando la insignia', error),
  )
}

/**
 * Chrome borra la insignia de la pestaña al navegar, y llegar a esta página
 * es una navegación: sin esto, la advertencia se vería sin "!!". Respeta
 * la preferencia "Mostrar insignia".
 */
async function showHighBadge(): Promise<void> {
  const [tab, settings] = await Promise.all([chrome.tabs.getCurrent(), getSettings()])
  if (tab?.id !== undefined) await updateBadge(tab.id, 'high', settings.showBadgeEnabled)
}

async function handleGoBack(
  warningId: string,
  safeReturnUrl: string | undefined,
  blockedUrl: string,
): Promise<void> {
  const tab = await chrome.tabs.getCurrent()
  if (!tab?.id) return

  await deleteWarningContext(warningId) // ya se actuó sobre esta advertencia, no hace falta conservarla
  await goToSafety(tab.id, safeReturnUrl, blockedUrl)
}

/**
 * La navegación la hace `background` (`chrome.tabs.update`), no esta
 * página — así se registra el bypass y se navega en la misma función,
 * sin una ventana entre "guardar" y "navegar" que dependa de un mensaje
 * de ida y vuelta más una segunda navegación disparada acá.
 */
async function handleContinueAnyway(warningId: string, url: string): Promise<void> {
  await deleteWarningContext(warningId)
  await chrome.runtime.sendMessage({ type: CONTINUE_MESSAGE_TYPE, url })
}

/**
 * "Confiar en este sitio" ya fue confirmado por el usuario en la propia
 * página (confirmación en línea, no `window.confirm()`) — acá solo se
 * dispara. `background/trustNavigation.ts` guarda el hostname en la
 * allowlist permanente y navega, en ese orden.
 */
async function handleConfirmTrust(warningId: string, url: string): Promise<void> {
  await deleteWarningContext(warningId)
  await chrome.runtime.sendMessage({ type: TRUST_MESSAGE_TYPE, url })
}

async function closeCurrentTab(): Promise<void> {
  const tab = await chrome.tabs.getCurrent()
  if (tab?.id) await chrome.tabs.remove(tab.id)
}

async function openNewTab(): Promise<void> {
  const tab = await chrome.tabs.getCurrent()
  if (tab?.id) await chrome.tabs.update(tab.id, { url: 'chrome://newtab/' })
}

main()

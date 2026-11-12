import { createYoutubeMainWorld } from '../adapters/youtube/mainWorld'
import { openMainChannel } from '../mainChannel'

/**
 * Parte MAIN del adaptador de YouTube (ver `mainWorld.ts`). Sin globales:
 * todo vive en el cierre del IIFE que genera CRXJS. Las órdenes llegan SOLO
 * por el canal privado (`mainChannel.ts`); los eventos que despache la
 * página en `document` se ignoran.
 */
/** Si el mundo aislado no da ninguna orden en este tiempo, se desinstala todo (fail-open). */
const GATE_TIMEOUT_MS = 10_000

const controller = createYoutubeMainWorld(window)
const channel = openMainChannel(document, (enabled) => controller.setEnabled(enabled))

setTimeout(() => {
  // Cierra también el establecimiento del canal: nadie puede anunciarse después.
  channel.lock()
  if (controller.gate() === 'unknown') controller.setEnabled(false)
}, GATE_TIMEOUT_MS)

import type { IsolatedChannel } from '../../mainChannel'
import type { PageAdapter } from '../../types'

export const YOUTUBE_ADAPTER_ID = 'youtube'
export const YOUTUBE_MATCHES: readonly string[] = ['https://www.youtube.com/*']

// Solo escritorio: es donde se midió el formato de las respuestas (m.youtube.com queda fuera).
export const isYoutubeHost = (hostname: string) => hostname.toLowerCase() === 'www.youtube.com'

/**
 * Adaptador de YouTube, lado aislado. No toca el DOM: solo ordena a la parte
 * MAIN (`mainWorld.ts`), por el canal privado (`mainChannel.ts`), si debe
 * sanear las respuestas del reproductor. `stop()` ordena desinstalar los
 * ganchos. Si el canal no llegó a establecerse no hace nada (fail-open: la
 * parte MAIN se desinstala sola por tiempo).
 */
export function createYoutubeAdapter(channel: IsolatedChannel | null): PageAdapter {
  return {
    id: YOUTUBE_ADAPTER_ID,
    matches: YOUTUBE_MATCHES,
    appliesTo: isYoutubeHost,
    start({ log }) {
      const sent = channel?.send(true) ?? false
      log(sent ? 'youtube:enabled' : 'youtube:channel-unavailable')
      return {
        stop() {
          channel?.send(false)
        },
      }
    },
    // Con "Anuncios" desactivado desde el inicio: se le dice explícitamente al
    // MAIN que desinstale sus ganchos, sin esperar el tiempo límite.
    announceInactive() {
      channel?.send(false)
    },
  }
}

import { jkanimeAdapter } from './adapters/jkanime/adapter'
import { createYoutubeAdapter } from './adapters/youtube/adapter'
import type { IsolatedChannel } from './mainChannel'
import type { PageAdapter } from './types'

/**
 * Adaptadores de sitio de la capa de página (mundo aislado). El de YouTube
 * recibe el canal privado hacia el mundo MAIN (abierto en `document_start`
 * por `entries/pageLayer.iife.ts`, solo en www.youtube.com).
 */
export function createPageAdapters(youtubeChannel: IsolatedChannel | null): PageAdapter[] {
  return [createYoutubeAdapter(youtubeChannel), jkanimeAdapter]
}

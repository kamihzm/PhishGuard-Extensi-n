import { selectorsForHost, type CosmeticIndex } from '../cosmetic/compileCosmetic'
import {
  isCosmeticRequest,
  trustedSenderHostname,
  type CosmeticResponse,
  type SenderInfo,
} from '../page/protocol'
import type { WebProtectionSettings } from '../settings'

/**
 * Servicio cosmético del background: responde a la capa de página con los
 * selectores de SU hostname. El hostname sale de `sender.url` (Chrome), no
 * del mensaje; se exige que el emisor sea esta extensión, en el marco
 * principal de una pestaña http(s). Con "Anuncios" desactivado o ante
 * cualquier error responde lista vacía (fail-open: no se oculta nada).
 */
export interface CosmeticServiceDeps {
  extensionId: string
  loadIndex(): Promise<CosmeticIndex>
  readSettings(): Promise<WebProtectionSettings>
}

const EMPTY: CosmeticResponse = { ok: true, selectors: [] }

export async function answerCosmeticRequest(
  message: unknown,
  sender: SenderInfo,
  deps: CosmeticServiceDeps,
): Promise<CosmeticResponse | null> {
  if (!isCosmeticRequest(message)) return null
  const hostname = trustedSenderHostname(sender, deps.extensionId)
  if (hostname === null) return { ok: false, selectors: [] }
  try {
    if (!(await deps.readSettings()).adsEnabled) return EMPTY
    return { ok: true, selectors: selectorsForHost(await deps.loadIndex(), hostname) }
  } catch {
    return EMPTY
  }
}

/** Carga perezosa y única del índice empaquetado (el service worker puede reiniciarse). */
export function createIndexLoader(
  fetchIndex: () => Promise<unknown>,
): () => Promise<CosmeticIndex> {
  let pending: Promise<CosmeticIndex> | null = null
  return () => {
    pending ??= fetchIndex().then((raw) => {
      if (
        typeof raw !== 'object' ||
        raw === null ||
        typeof (raw as CosmeticIndex).hide !== 'object' ||
        typeof (raw as CosmeticIndex).allow !== 'object'
      ) {
        throw new Error('índice cosmético inválido')
      }
      return raw as CosmeticIndex
    })
    pending.catch(() => {
      pending = null
    })
    return pending
  }
}

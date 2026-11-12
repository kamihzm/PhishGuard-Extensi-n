import type { TrustedSite } from './types'

/** Acceso crudo a `chrome.storage.local` — igual que el historial, nunca `sync` (no debe salir de este navegador). */
const TRUSTED_SITES_STORAGE_KEY = 'phishguard:trusted-sites'

export async function readTrustedSites(): Promise<TrustedSite[]> {
  const stored = await chrome.storage.local.get(TRUSTED_SITES_STORAGE_KEY)
  const sites = stored[TRUSTED_SITES_STORAGE_KEY]
  return Array.isArray(sites) ? (sites as TrustedSite[]) : []
}

export async function writeTrustedSites(sites: TrustedSite[]): Promise<void> {
  await chrome.storage.local.set({ [TRUSTED_SITES_STORAGE_KEY]: sites })
}

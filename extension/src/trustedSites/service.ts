import { normalizeTrustedHostname } from './normalizeTrustedHostname'
import { readTrustedSites, writeTrustedSites } from './storage'
import type { TrustedSite } from './types'

export async function getTrustedSites(): Promise<TrustedSite[]> {
  return readTrustedSites()
}

/** Acepta una URL completa o un hostname suelto (ej. escrito a mano en el formulario de "agregar dominio"). Idempotente: agregar el mismo hostname dos veces no duplica la entrada. */
export async function addTrustedSite(urlOrHostname: string): Promise<TrustedSite> {
  const hostname = normalizeTrustedHostname(urlOrHostname)
  const sites = await readTrustedSites()

  const existing = sites.find((site) => site.hostname === hostname)
  if (existing) return existing

  const site: TrustedSite = { hostname, addedAt: new Date().toISOString() }
  await writeTrustedSites([site, ...sites])
  return site
}

export async function removeTrustedSite(hostname: string): Promise<void> {
  const sites = await readTrustedSites()
  await writeTrustedSites(sites.filter((site) => site.hostname !== hostname))
}

export async function clearTrustedSites(): Promise<void> {
  await writeTrustedSites([])
}

/** Coincidencia EXACTA por hostname — nunca por dominio padre ni por subdominio. `accounts.example.com` no habilita `example.com` ni `evil.example.com`. */
export async function isTrustedHostname(hostname: string): Promise<boolean> {
  const sites = await readTrustedSites()
  const normalized = hostname.toLowerCase()
  return sites.some((site) => site.hostname === normalized)
}

/** Variante para el motor de navegación, que tiene una URL completa, no un hostname suelto. Una URL inválida simplemente no está en la allowlist — nunca rompe el flujo. */
export async function isTrustedUrl(url: string): Promise<boolean> {
  let hostname: string
  try {
    hostname = new URL(url).hostname
  } catch {
    return false
  }
  return isTrustedHostname(hostname)
}

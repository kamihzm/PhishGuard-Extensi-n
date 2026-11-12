/** Un sitio marcado como confiable por el usuario. Se guarda por `hostname`, nunca por URL completa. */
export interface TrustedSite {
  hostname: string
  addedAt: string
}

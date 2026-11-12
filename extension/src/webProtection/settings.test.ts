import { describe, expect, it } from 'vitest'
import { SETTINGS_STORAGE_KEY } from '../settings/storage'
import {
  DEFAULT_WEB_PROTECTION_EXPERIMENTS,
  DEFAULT_WEB_PROTECTION_SETTINGS,
  enabledCategoriesOf,
  mergeWebProtectionExperiments,
  mergeWebProtectionSettings,
  readWebProtectionSettings,
  updateWebProtectionSetting,
  WEB_PROTECTION_EXPERIMENTS_KEY,
  WEB_PROTECTION_SETTINGS_KEY,
  type KeyValueStorage,
} from './settings'

function memoryStorage(initial: Record<string, unknown> = {}): KeyValueStorage & {
  data: Record<string, unknown>
} {
  const data = { ...initial }
  return {
    data,
    get: async (key) => (key in data ? { [key]: data[key] } : {}),
    set: async (items) => {
      Object.assign(data, items)
    },
  }
}

describe('configuración de Web Protection', () => {
  it('usa una clave propia, distinta de la configuración del motor de phishing', () => {
    expect(WEB_PROTECTION_SETTINGS_KEY).not.toBe(SETTINGS_STORAGE_KEY)
  })

  it('por defecto anuncios y rastreadores están activados', async () => {
    expect(await readWebProtectionSettings(memoryStorage())).toEqual({
      adsEnabled: true,
      trackersEnabled: true,
    })
  })

  it('valida campo por campo: un valor corrupto cae a su default sin descartar el resto', () => {
    expect(mergeWebProtectionSettings({ adsEnabled: false, trackersEnabled: 'sí' })).toEqual({
      adsEnabled: false,
      trackersEnabled: true,
    })
    expect(mergeWebProtectionSettings('basura')).toEqual(DEFAULT_WEB_PROTECTION_SETTINGS)
  })

  it('actualizar un toggle persiste solo en su clave y no toca la configuración de phishing', async () => {
    const phishing = { phishingProtectionEnabled: true, highRiskWarningEnabled: true }
    const storage = memoryStorage({ [SETTINGS_STORAGE_KEY]: phishing })
    await updateWebProtectionSetting(storage, 'adsEnabled', false)
    expect(storage.data[WEB_PROTECTION_SETTINGS_KEY]).toEqual({
      adsEnabled: false,
      trackersEnabled: true,
    })
    expect(storage.data[SETTINGS_STORAGE_KEY]).toEqual(phishing)
  })

  it('traduce los toggles a categorías de listas', () => {
    expect([...enabledCategoriesOf({ adsEnabled: true, trackersEnabled: false })]).toEqual(['ads'])
    expect([...enabledCategoriesOf({ adsEnabled: false, trackersEnabled: false })]).toEqual([])
  })
})

describe('experimentos de Web Protection', () => {
  it('usan su propia clave y están desactivados por defecto', () => {
    expect(WEB_PROTECTION_EXPERIMENTS_KEY).not.toBe(WEB_PROTECTION_SETTINGS_KEY)
    expect(DEFAULT_WEB_PROTECTION_EXPERIMENTS).toEqual({ popupGuardTabCreated: false })
    expect(mergeWebProtectionExperiments(undefined)).toEqual({ popupGuardTabCreated: false })
  })

  it('solo se activan con un booleano explícito', () => {
    expect(mergeWebProtectionExperiments({ popupGuardTabCreated: true })).toEqual({
      popupGuardTabCreated: true,
    })
    expect(mergeWebProtectionExperiments({ popupGuardTabCreated: 'sí' })).toEqual({
      popupGuardTabCreated: false,
    })
  })
})

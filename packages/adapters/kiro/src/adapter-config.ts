import type { KiroAdapterConfig } from './config-schema'

export {}

declare module '@oneworks/types' {
  interface Cache {
    'adapter.kiro.session': {
      kiroSessionId?: string
      title?: string
    }
  }

  interface AdapterMap {
    kiro: KiroAdapterConfig
  }
}

import type { JunieAdapterConfig } from './config-schema'

export {}

declare module '@oneworks/types' {
  interface Cache {
    'adapter.junie.session': {
      junieSessionId?: string
      title?: string
    }
  }

  interface AdapterMap {
    junie: JunieAdapterConfig
  }
}

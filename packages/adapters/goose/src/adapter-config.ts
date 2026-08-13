import type { GooseAdapterConfig } from './config-schema'

export {}

declare module '@oneworks/types' {
  interface Cache {
    'adapter.goose.session': {
      gooseSessionId?: string
    }
  }

  interface AdapterMap {
    goose: GooseAdapterConfig
  }
}

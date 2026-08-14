import type { ClineAdapterConfig } from './config-schema.js'

export {}

declare module '@oneworks/types' {
  interface Cache {
    'adapter.cline.session': {
      authenticatedMethodId?: string
      nativeSessionId?: string
      protocolVersion?: number
      version?: string
    }
  }

  interface AdapterMap {
    cline: ClineAdapterConfig
  }
}

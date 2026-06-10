import type { CodexAdapterConfig } from './config-schema.js'

export {}

declare module '@oneworks/types' {
  interface AdapterMap {
    'codex': CodexAdapterConfig
  }
}

declare module '@oneworks/types' {
  interface Cache {
    'adapter.codex.threads': Record<string, string>
  }
}

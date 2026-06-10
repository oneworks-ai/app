import type { KimiAdapterConfig } from './config-schema.js'

export {}

declare module '@oneworks/types' {
  interface AdapterMap {
    kimi: KimiAdapterConfig
  }
}

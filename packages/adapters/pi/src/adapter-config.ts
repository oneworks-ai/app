import type { PiAdapterConfig } from './config-schema.js'

export {}

declare module '@oneworks/types' {
  interface AdapterMap {
    pi: PiAdapterConfig
  }
}

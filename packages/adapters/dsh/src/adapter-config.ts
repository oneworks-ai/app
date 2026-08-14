import type { DshAdapterConfig } from './config-schema.js'

export {}

declare module '@oneworks/types' {
  interface AdapterMap {
    dsh: DshAdapterConfig
  }
}

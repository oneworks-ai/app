import type { AdapterAccountQuotaInfo } from '@oneworks/types'

import type { CodexAdapterConfig } from './config-schema.js'

export {}

declare module '@oneworks/types' {
  interface AdapterMap {
    'codex': CodexAdapterConfig
  }
}

declare module '@oneworks/types' {
  interface Cache {
    'adapter.codex.account-quotas': Record<string, {
      workspace?: string
      accountKey?: string
      fingerprint?: string
      quota: AdapterAccountQuotaInfo
      resetCreditDetailsCapturedAt?: number
    }>
    'adapter.codex.threads': Record<string, string>
  }
}

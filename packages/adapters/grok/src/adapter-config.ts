import type { ManagedNpmCliConfig } from '@oneworks/utils/managed-npm-cli'

export {}

declare module '@oneworks/types' {
  interface AdapterMap {
    grok: {
      cli?: ManagedNpmCliConfig
      configContent?: Record<string, unknown>
      disableAutoUpdate?: boolean
      disableMemory?: boolean
      disableSubagents?: boolean
      disableWebSearch?: boolean
      effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max' | 'ultra'
    }
  }
}

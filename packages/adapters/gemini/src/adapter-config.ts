import type { ManagedNpmCliConfig } from '@oneworks/utils/managed-npm-cli'

export {}

declare module '@oneworks/types' {
  interface Cache {
    'adapter.gemini.session': {
      geminiSessionId?: string
    }
  }

  interface AdapterMap {
    gemini: {
      cli?: ManagedNpmCliConfig
      disableExtensions?: boolean
      disableSubagents?: boolean
      disableAutoUpdate?: boolean
      telemetry?: 'off' | 'inherit'
      nativePromptCommands?: 'reject' | 'allow'
    }
  }
}

import type { ManagedNpmCliConfig } from '@oneworks/utils/managed-npm-cli'

export {}

declare module '@oneworks/types' {
  interface Cache {
    'adapter.qwen-code.session': {
      qwenSessionId?: string
    }
  }

  interface AdapterMap {
    'qwen-code': {
      cli?: ManagedNpmCliConfig
      disableAutoUpdate?: boolean
      disableExtensions?: boolean
      disableSubagents?: boolean
      nativePromptCommands?: 'allow' | 'reject'
      settingsContent?: Record<string, unknown>
      telemetry?: 'inherit' | 'off'
    }
  }
}

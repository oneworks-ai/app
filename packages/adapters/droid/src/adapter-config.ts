import type { ManagedNpmCliConfig } from '@oneworks/utils/managed-npm-cli'

export {}

declare module '@oneworks/types' {
  interface Cache {
    'adapter.droid.session': {
      droidSessionId?: string
      title?: string
    }
  }

  interface AdapterMap {
    droid: {
      cli?: ManagedNpmCliConfig
      configContent?: Record<string, unknown>
      disableBuiltinSkills?: boolean
      effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max'
    }
  }
}

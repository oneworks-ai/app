import type { CursorAdapterConfig } from './config-schema'

export {}

declare module '@oneworks/types' {
  interface Cache {
    'adapter.cursor.session': {
      cursorSessionId?: string
      title?: string
    }
  }

  interface AdapterMap {
    cursor: CursorAdapterConfig
  }
}

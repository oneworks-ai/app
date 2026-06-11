declare module 'pngjs' {
  import type { Buffer } from 'node:buffer'

  export class PNG {
    static sync: {
      write: (png: { width: number; height: number; data: Buffer | Uint8Array }) => Buffer
    }
  }
}

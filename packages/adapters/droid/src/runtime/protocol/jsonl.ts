import { Buffer } from 'node:buffer'

export const DEFAULT_MAX_FACTORY_JSONL_FRAME_BYTES = 8 * 1024 * 1024

export class JsonlDecoder {
  private buffer = ''

  constructor(private readonly maxFrameBytes = DEFAULT_MAX_FACTORY_JSONL_FRAME_BYTES) {}

  push(chunk: string) {
    this.buffer += chunk
    const lines = this.buffer.split(/\r?\n/u)
    this.buffer = lines.pop() ?? ''
    try {
      for (const line of [...lines, this.buffer]) {
        if (Buffer.byteLength(line, 'utf8') > this.maxFrameBytes) {
          throw new Error(`Factory Droid JSONL frame exceeded ${this.maxFrameBytes} bytes.`)
        }
      }
      return lines.filter(line => line.trim() !== '')
    } catch (error) {
      this.buffer = ''
      throw error
    }
  }

  finish() {
    const line = this.buffer.trim()
    this.buffer = ''
    if (Buffer.byteLength(line, 'utf8') > this.maxFrameBytes) {
      throw new Error(`Factory Droid JSONL frame exceeded ${this.maxFrameBytes} bytes.`)
    }
    return line === '' ? [] : [line]
  }
}

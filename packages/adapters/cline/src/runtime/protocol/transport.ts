import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { Readable } from 'node:stream'

import { ndJsonStream } from '@agentclientprotocol/sdk'

const getError = (error: unknown, fallback: string) => error instanceof Error ? error : new Error(fallback)

export const createClineAcpTransport = (process: ChildProcessWithoutNullStreams) => {
  let inputClosing = false
  let failed = false
  let rejectFailure: (error: Error) => void = () => undefined
  const failure = new Promise<never>((_resolve, reject) => {
    rejectFailure = reject
  })
  // The failure is also raced by every request. This local handler guarantees a late
  // stdin close cannot become an unhandled rejection after the last request settles.
  void failure.catch(() => undefined)
  const fail = (error: unknown, fallback: string) => {
    if (failed || inputClosing) return
    failed = true
    rejectFailure(getError(error, fallback))
  }

  process.stdin.on('error', error => fail(error, 'Cline ACP stdin failed.'))
  process.stdin.on('close', () => fail(undefined, 'Cline ACP stdin closed unexpectedly.'))

  const safeOutput = new WritableStream<Uint8Array>({
    write(chunk) {
      if (process.stdin.destroyed || process.stdin.writableEnded || !process.stdin.writable) {
        fail(undefined, 'Cline ACP stdin was not writable.')
        return
      }
      return new Promise<void>((resolve) => {
        let settled = false
        const settle = (error?: Error | null) => {
          if (settled) return
          settled = true
          if (error != null) fail(error, 'Cline ACP stdin write failed.')
          resolve()
        }
        try {
          process.stdin.write(chunk, settle)
        } catch (error) {
          fail(error, 'Cline ACP stdin write failed.')
          settle()
        }
      })
    },
    close() {
      inputClosing = true
      if (!process.stdin.destroyed && !process.stdin.writableEnded) process.stdin.end()
    },
    abort() {
      inputClosing = true
      if (!process.stdin.destroyed) process.stdin.destroy()
    }
  })

  return {
    closeInput() {
      inputClosing = true
      if (!process.stdin.destroyed && !process.stdin.writableEnded) process.stdin.end()
    },
    failure,
    stream: ndJsonStream(
      safeOutput,
      Readable.toWeb(process.stdout) as ReadableStream<Uint8Array>
    )
  }
}

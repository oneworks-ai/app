import type { ChildProcess } from 'node:child_process'

import { badRequest, conflict, internalServerError } from '#~/utils/http.js'
import type { PublishOutcome } from './asset-create-filesystem.js'
import type { PublishProcessControl, WorkerError, WorkerResult } from './asset-publish-protocol.js'
import { PublishProtocolFence } from './asset-publish-protocol.js'

const publishError = (result: WorkerError) => {
  const details = {
    committed: false as const,
    ...(result.privateStaging == null ? {} : { privateStaging: result.privateStaging })
  }
  if (result.code === 'asset_exists') return conflict('Asset path already exists', details, result.code)
  if (result.code === 'asset_destination_changed') {
    return badRequest('Asset destination changed', details, result.code)
  }
  return internalServerError('Data asset publishing failed', {
    code: result.code,
    details
  })
}

export class AssetPublishSettlement {
  readonly protocol = new PublishProtocolFence()
  #controlTimer?: NodeJS.Timeout
  #lifecycle: 'result' | 'running' | 'settled' | 'terminating' = 'running'
  #reapTimer?: NodeJS.Timeout
  #result?: WorkerResult
  #stagingRetained = false
  #stderr = ''

  constructor(
    private readonly options: {
      child: ChildProcess
      control?: PublishProcessControl
      reject: (error: unknown) => void
      resolve: (outcome: PublishOutcome) => void
    }
  ) {}

  get running() {
    return this.#lifecycle === 'running'
  }

  addStderr(chunk: string) {
    if (this.#stderr.length < 1_024) this.#stderr += chunk
  }

  armControl(token: number) {
    clearTimeout(this.#controlTimer)
    this.#controlTimer = setTimeout(() => {
      if (this.isCurrent(token)) this.terminate()
    }, this.options.control?.controlTimeoutMs ?? 30_000)
  }

  acceptResult(result: WorkerResult) {
    if (this.#lifecycle === 'settled' || this.#result != null) return
    this.#result = result
    if (this.running) {
      this.#lifecycle = 'result'
      this.protocol.fence()
      clearTimeout(this.#controlTimer)
      this.#armReap()
    }
  }

  isCurrent(token: number) {
    return this.running && this.protocol.isCurrent(token)
  }

  markStagingRetained() {
    this.#stagingRetained = true
  }

  failPreCommit(error: unknown) {
    if (!this.running) return
    this.#lifecycle = 'settled'
    this.protocol.fence()
    this.#clearTimers()
    try {
      this.options.child.stdin?.destroy()
    } catch {}
    try {
      this.options.child.kill()
    } catch {}
    this.options.reject(error)
  }

  terminate() {
    if (!this.running) return
    this.#lifecycle = 'terminating'
    this.protocol.fence()
    clearTimeout(this.#controlTimer)
    try {
      this.options.child.stdin?.destroy()
    } catch {}
    try {
      const terminate = this.options.control?.terminate ?? (child => {
        child.kill()
      })
      terminate(this.options.child)
    } catch {}
    this.#armReap()
  }

  finishClosed() {
    if (this.#lifecycle === 'settled') return
    this.#lifecycle = 'settled'
    this.#clearTimers()
    if (this.#result?.state === 'error') this.options.reject(publishError(this.#result))
    else if (this.#result != null) this.options.resolve(this.#result)
    else if (this.protocol.visibilityPossible) {
      this.options.resolve({
        state: 'committed-indeterminate',
        warnings: [
          'asset_publisher_response_lost',
          ...(this.#stagingRetained ? ['asset_private_staging_retained'] : [])
        ]
      })
    } else {
      this.options.reject(this.#preCommitFailure())
    }
  }

  #armReap() {
    clearTimeout(this.#reapTimer)
    this.#reapTimer = setTimeout(
      () => this.#settleIndeterminate('asset_publisher_termination_unconfirmed'),
      this.options.control?.terminationTimeoutMs ?? 5_000
    )
  }

  #clearTimers() {
    clearTimeout(this.#controlTimer)
    clearTimeout(this.#reapTimer)
  }

  #preCommitFailure() {
    return internalServerError('Asset publish failed before visibility', {
      code: 'asset_publish_failed',
      details: {
        committed: false,
        ...(this.#stagingRetained ? { privateStaging: 'retained' } : {})
      },
      cause: this.#stderr
    })
  }

  #settleIndeterminate(warning: string) {
    if (this.#lifecycle === 'settled') return
    this.#lifecycle = 'settled'
    this.protocol.fence()
    this.#clearTimers()
    this.options.resolve({
      state: 'committed-indeterminate',
      warnings: [
        warning,
        ...(this.#stagingRetained ? ['asset_private_staging_retained'] : [])
      ]
    })
  }
}

import type { ChildProcess } from 'node:child_process'

import type { MutationPreCommitFailureDetails } from '@oneworks/types'

import type { PublishOutcome } from './asset-create-filesystem.js'

export type PublishStage =
  | 'publishing'
  | 'staged'
  | 'target-absent'
  | 'target-probed'
  | 'visible'

export type WorkerError = MutationPreCommitFailureDetails & {
  code: string
  state: 'error'
}

export type WorkerResult = PublishOutcome | WorkerError

export interface PublishProcessControl {
  controlTimeoutMs?: number
  send?: (
    child: ChildProcess,
    message: object,
    callback: (error: Error | null) => void
  ) => void
  terminate?: (child: ChildProcess) => void
  terminationTimeoutMs?: number
}

const transitions: Record<'ready' | PublishStage, PublishStage[]> = {
  ready: ['target-absent', 'staged'],
  'target-absent': ['staged'],
  staged: ['publishing'],
  publishing: ['visible'],
  visible: ['target-probed'],
  'target-probed': []
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value != null && typeof value === 'object' && !Array.isArray(value)

const isWorkerError = (value: Record<string, unknown>): value is WorkerError => (
  value.state === 'error' &&
  typeof value.code === 'string' &&
  value.committed === false &&
  (value.privateStaging == null || value.privateStaging === 'retained')
)

const isPublishOutcome = (value: Record<string, unknown>): value is PublishOutcome => (
  (value.state === 'committed' || value.state === 'committed-degraded' || value.state === 'committed-indeterminate') &&
  (value.warnings == null ||
    (Array.isArray(value.warnings) && value.warnings.every(warning => typeof warning === 'string')))
)

export const parseWorkerResult = (value: unknown): WorkerResult | undefined => {
  if (!isRecord(value)) return
  if (isWorkerError(value) || isPublishOutcome(value)) return value
}

export class PublishProtocolFence {
  #activeToken = 0
  #controlId = 0
  #currentStage: 'ready' | PublishStage | undefined
  #running = true
  #visibilityPossible = false

  beginReady() {
    if (!this.#running || this.#currentStage != null) return
    this.#currentStage = 'ready'
    return ++this.#activeToken
  }

  beginStage(value: unknown) {
    if (!this.#running) return
    if (
      !isRecord(value) ||
      value.type !== 'asset-publish-stage' ||
      !Number.isSafeInteger(value.controlId) ||
      typeof value.stage !== 'string'
    ) {
      throw new Error('invalid-publisher-stage')
    }
    const stage = value.stage as PublishStage
    if (
      this.#currentStage == null ||
      value.controlId !== this.#controlId + 1 ||
      !transitions[this.#currentStage].includes(stage)
    ) {
      throw new Error('out-of-order-publisher-stage')
    }
    this.#controlId = value.controlId as number
    this.#currentStage = stage
    return { controlId: this.#controlId, stage, token: ++this.#activeToken }
  }

  authorizeVisibility(token: number) {
    if (!this.isCurrent(token)) return false
    this.#visibilityPossible = true
    return true
  }

  fence() {
    if (!this.#running) return false
    this.#running = false
    this.#activeToken += 1
    return true
  }

  isCurrent(token: number) {
    return this.#running && token === this.#activeToken
  }

  get visibilityPossible() {
    return this.#visibilityPossible
  }
}

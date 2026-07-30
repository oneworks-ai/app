import { lstat } from 'node:fs/promises'
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path'

import type { MutationCommitState } from '@oneworks/types'

import { badRequest } from '#~/utils/http.js'
import { ensureSafeDirectory } from './asset-create-destination.js'
import type { FileIdentity } from './asset-create-destination.js'
import { markAssetPreCommitFailure } from './asset-create-error.js'
import { runAssetPublishProcess } from './asset-publish-process.js'
import type { PublishProcessControl } from './asset-publish-protocol.js'
import { ASSET_PUBLISH_WORKER } from './asset-publish-worker.js'

export interface PublishOutcome {
  state: MutationCommitState
  warnings?: string[]
}

interface PublishStageContext {
  stagingName?: string
}

export interface PublishOperations {
  afterAuthorityClaim?: () => Promise<void>
  afterTargetAbsent?: () => Promise<void>
  afterTargetProbe?: () => Promise<void>
  afterTempSync?: (context: PublishStageContext) => Promise<void>
  afterVisible?: () => Promise<void>
  processControl?: PublishProcessControl
  fault?:
    | 'crash-after-staging'
    | 'delay-publishing'
    | 'disconnect-before-publishing'
    | 'identity-probe'
    | 'prepublish'
    | 'publish-sync'
    | 'response-after-visible'
    | 'staging-close'
}

const safelyPublishFileOwned = async (
  params: {
    content: string
    targetPath: string
    workspaceIdentity?: FileIdentity
    workspaceRoot: string
  },
  operations: PublishOperations = {}
): Promise<PublishOutcome> => {
  const parent = dirname(params.targetPath)
  const targetName = basename(params.targetPath)
  if (resolve(parent, targetName) !== resolve(params.targetPath)) {
    throw badRequest('Invalid asset path', undefined, 'invalid_asset_name')
  }
  const { directory, workspaceRoot } = await ensureSafeDirectory(
    params.workspaceRoot,
    parent,
    params.workspaceIdentity
  )
  const parentStat = await lstat(directory, { bigint: true })
  const rootStat = await lstat(workspaceRoot, { bigint: true })
  const parentRelative = relative(workspaceRoot, directory)
  if (
    parentRelative === '' ||
    parentRelative === '..' ||
    parentRelative.startsWith(`..${sep}`) ||
    isAbsolute(parentRelative)
  ) {
    throw badRequest('Invalid asset destination', undefined, 'asset_destination_forbidden')
  }
  const pausedStages = [
    operations.afterTargetAbsent == null ? '' : 'target-absent',
    operations.afterTargetProbe == null ? '' : 'target-probed'
  ].filter(Boolean).join(',')
  const args = [
    '--input-type=module',
    '--eval',
    ASSET_PUBLISH_WORKER,
    String(rootStat.dev),
    String(rootStat.ino),
    String(parentStat.dev),
    String(parentStat.ino),
    parentRelative,
    targetName,
    operations.fault ?? '',
    pausedStages
  ]
  return runAssetPublishProcess({
    args,
    content: params.content,
    control: operations.processControl,
    directory,
    expectedParent: {
      dev: String(parentStat.dev),
      ino: String(parentStat.ino)
    },
    operations,
    workspaceRoot
  })
}

export const safelyPublishFile = async (
  params: Parameters<typeof safelyPublishFileOwned>[0],
  operations: PublishOperations = {}
): Promise<PublishOutcome> => {
  try {
    return await safelyPublishFileOwned(params, operations)
  } catch (error) {
    throw markAssetPreCommitFailure(
      error,
      'Data asset publishing failed',
      'asset_publish_failed'
    )
  }
}

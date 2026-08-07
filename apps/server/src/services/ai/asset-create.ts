import { Buffer } from 'node:buffer'
import { lstat } from 'node:fs/promises'
import { basename, dirname, relative, resolve, sep } from 'node:path'

import type { DefinitionLoader } from '@oneworks/definition-loader'
import { FilesystemAuthorityError, openFilesystemAuthority } from '@oneworks/fs-authority-native'
import type { FilesystemAuthority } from '@oneworks/fs-authority-native'
import type { MutationCommitState } from '@oneworks/types'

import { badRequest, conflict, internalServerError } from '#~/utils/http.js'
import type { FileIdentity } from './asset-create-destination.js'
import { inspectSafeDestination, isInsideWorkspace } from './asset-create-destination.js'
import { ASSET_PRE_COMMIT_DETAILS, markAssetPreCommitFailure } from './asset-create-error.js'
import { safelyPublishFile } from './asset-create-filesystem.js'
import { renderCreatedAsset, validateCreateAssetInput } from './asset-create-input.js'
import type { CreatableAssetKind } from './asset-create-input.js'
import {
  assertAssetSemanticAvailability,
  getAssetPublication,
  getAssetTargetDirectory
} from './asset-create-semantics.js'

export type OpenAssetFilesystemAuthority = (workspaceRoot: string) => Promise<FilesystemAuthority>
export interface CreatedProjectAsset {
  commitState?: MutationCommitState
  kind: CreatableAssetKind
  path: string
  warnings?: readonly string[]
}
const claimReleaseTimeoutMs = 5_000
const releaseClaim = async (authority: FilesystemAuthority, generation: number) => {
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      authority.release(generation).catch(() => false),
      new Promise<boolean>(resolve => {
        timeout = setTimeout(() => resolve(false), claimReleaseTimeoutMs)
        timeout.unref?.()
      })
    ])
  } finally {
    if (timeout != null) clearTimeout(timeout)
  }
}
const assertWorkspaceCurrent = async (workspaceRoot: string, expected?: FileIdentity) => {
  if (expected == null) return
  const current = await lstat(workspaceRoot, { bigint: true })
  if (
    current.isSymbolicLink() || !current.isDirectory() || current.dev !== expected.dev || current.ino !== expected.ino
  ) throw badRequest('Workspace authority changed', undefined, 'asset_workspace_changed')
}
const createProjectAssetOwned = async (
  params: {
    input: unknown
    loader: DefinitionLoader
    openAuthority?: OpenAssetFilesystemAuthority
    workspaceIdentity?: FileIdentity
    workspaceRoot: string
  }
) => {
  const input = validateCreateAssetInput(params.input)
  const publication = getAssetPublication(params.workspaceRoot, input)
  await assertWorkspaceCurrent(params.workspaceRoot, params.workspaceIdentity)
  let authority: FilesystemAuthority
  try {
    authority = await (params.openAuthority ?? openFilesystemAuthority)(params.workspaceRoot)
  } catch (cause) {
    throw internalServerError('Filesystem authority unavailable', {
      cause,
      code: 'asset_filesystem_authority_unavailable',
      details: ASSET_PRE_COMMIT_DETAILS
    })
  }
  let generation: number | undefined
  let publishAttempted = false
  let result: CreatedProjectAsset | undefined
  let failure: unknown
  try {
    try {
      generation = await authority.claim(input.kind, input.slug)
    } catch (error) {
      if (error instanceof FilesystemAuthorityError && error.code === 'asset_create_in_progress') {
        throw conflict(
          'Data asset creation is already in progress',
          { ...ASSET_PRE_COMMIT_DETAILS, name: input.slug },
          error.code
        )
      }
      throw error
    }
    await assertAssetSemanticAvailability(params.loader, input)
    await assertWorkspaceCurrent(params.workspaceRoot, params.workspaceIdentity)
    publishAttempted = true
    const outcome = await safelyPublishFile({
      authority,
      authorityId: authority.id,
      basename: publication.basename,
      bytes: Buffer.from(renderCreatedAsset(input), 'utf8'),
      generation,
      parentSegments: publication.parentSegments
    })
    result = {
      kind: input.kind,
      path: publication.path,
      ...(outcome.state === 'committed' ? {} : { commitState: outcome.state, warnings: outcome.warnings })
    }
  } catch (error) {
    failure = error instanceof Error && 'status' in error
      ? error
      : publishAttempted
      ? internalServerError('Asset publication status is indeterminate', {
        cause: error,
        code: 'asset_publish_indeterminate',
        details: { committed: 'indeterminate' }
      })
      : markAssetPreCommitFailure(error)
  }
  const releaseIndeterminate = generation != null && !publishAttempted && !(await releaseClaim(authority, generation))
  let closeFailed = false
  try {
    authority.close()
  } catch {
    closeFailed = true
  }
  if (releaseIndeterminate) {
    throw internalServerError('Asset claim cleanup status is indeterminate', {
      code: 'asset_claim_indeterminate',
      details: { committed: false }
    })
  }
  if (failure != null) throw failure
  if (result == null) {
    throw internalServerError('Asset publication status is indeterminate', {
      code: 'asset_publish_indeterminate',
      details: { committed: 'indeterminate' }
    })
  }
  if (closeFailed) {
    const warnings = new Set(result.warnings ?? [])
    warnings.add('asset_authority_close_failed')
    const commitState: MutationCommitState = result.commitState === 'committed-indeterminate'
      ? 'committed-indeterminate'
      : 'committed-degraded'
    return {
      ...result,
      commitState,
      warnings: [...warnings]
    }
  }
  return result
}
export const createProjectAsset = async (
  params: Parameters<typeof createProjectAssetOwned>[0]
): Promise<CreatedProjectAsset> => {
  try {
    return await createProjectAssetOwned(params)
  } catch (error) {
    throw markAssetPreCommitFailure(error)
  }
}
export const getProjectAssetPreview = async (
  workspaceRoot: string,
  input: unknown,
  workspaceIdentity?: FileIdentity
) => {
  const validated = validateCreateAssetInput(input)
  const targetPath = resolve(getAssetTargetDirectory(workspaceRoot, validated.kind), `${validated.slug}.md`)
  if (!isInsideWorkspace(workspaceRoot, targetPath)) {
    throw badRequest('Asset destination is outside the current workspace', undefined, 'asset_destination_forbidden')
  }
  const inspected = await inspectSafeDestination(workspaceRoot, dirname(targetPath), workspaceIdentity)
  const canonicalTargetPath = resolve(inspected.directory, basename(targetPath))
  return { kind: validated.kind, path: relative(inspected.workspaceRoot, canonicalTargetPath).split(sep).join('/') }
}

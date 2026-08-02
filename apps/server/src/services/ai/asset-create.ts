import { Buffer } from 'node:buffer'
import { lstat } from 'node:fs/promises'
import { basename, dirname, relative, resolve, sep } from 'node:path'

import type { DefinitionLoader } from '@oneworks/definition-loader'
import { FilesystemAuthorityError, openFilesystemAuthority } from '@oneworks/fs-authority-native'
import type { FilesystemAuthority } from '@oneworks/fs-authority-native'

import { badRequest, conflict, internalServerError } from '#~/utils/http.js'
import type { FileIdentity } from './asset-create-destination.js'
import { inspectSafeDestination, isInsideWorkspace } from './asset-create-destination.js'
import { safelyPublishFile } from './asset-create-filesystem.js'
import { renderCreatedAsset, validateCreateAssetInput } from './asset-create-input.js'
import {
  assertAssetSemanticAvailability,
  getAssetPublication,
  getAssetTargetDirectory
} from './asset-create-semantics.js'

export type OpenAssetFilesystemAuthority = (workspaceRoot: string) => Promise<FilesystemAuthority>
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
export const createProjectAsset = async (
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
      code: 'asset_filesystem_authority_unavailable'
    })
  }
  let generation: number | undefined
  let publishAttempted = false
  let result: { kind: string; path: string; commitState?: string; warnings?: readonly string[] } | undefined
  let failure: unknown
  try {
    try {
      generation = await authority.claim(input.kind, input.slug)
    } catch (error) {
      if (error instanceof FilesystemAuthorityError && error.code === 'asset_create_in_progress') {
        throw conflict('Data asset creation is already in progress', { name: input.slug }, error.code)
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
      : internalServerError('Failed to create data asset', { cause: error, code: 'asset_create_failed' })
  }
  const releaseIndeterminate = generation != null && !publishAttempted && !(await releaseClaim(authority, generation))
  authority.close()
  if (releaseIndeterminate) {
    throw internalServerError('Asset claim cleanup status is indeterminate', {
      code: 'asset_claim_indeterminate',
      details: { committed: false }
    })
  }
  if (failure != null) throw failure
  if (result == null) {
    throw internalServerError('Asset creation did not produce a result', { code: 'asset_create_failed' })
  }
  return result
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

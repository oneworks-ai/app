import { basename, dirname, relative, resolve, sep } from 'node:path'
import process from 'node:process'

import { resolveEntityIdentifier, resolveSpecIdentifier } from '@oneworks/definition-core'
import { DefinitionLoader } from '@oneworks/definition-loader'
import type { Definition, Entity, MutationCommitState, Rule, Spec } from '@oneworks/types'
import { resolveProjectOoBaseDir, resolveProjectOoEntitiesDir, toCanonicalAssetSlug } from '@oneworks/utils'

import { badRequest, conflict, internalServerError } from '#~/utils/http.js'
import type { FileIdentity } from './asset-create-destination.js'
import { ensureSafeDirectory, inspectSafeDestination, isInsideWorkspace } from './asset-create-destination.js'
import { markAssetPreCommitFailure } from './asset-create-error.js'
import { safelyPublishFile } from './asset-create-filesystem.js'
import type { PublishOperations, PublishOutcome } from './asset-create-filesystem.js'
import { renderCreatedAsset, validateCreateAssetInput } from './asset-create-input.js'
import type { CreatableAssetKind, ValidatedCreateAssetInput } from './asset-create-input.js'
import { acquireAssetLock } from './asset-create-lock.js'

export type { CreatableAssetKind } from './asset-create-input.js'

export interface CreatedProjectAsset {
  commitState?: MutationCommitState
  kind: CreatableAssetKind
  path: string
  warnings?: string[]
}

const assetPathEnv = (workspaceRoot: string) => ({
  ...process.env,
  __ONEWORKS_PROJECT_WORKSPACE_FOLDER__: workspaceRoot,
  __ONEWORKS_PROJECT_WORKSPACE_FOLDER_RESOLVE_CWD__: workspaceRoot
})

export const createAssetDefinitionLoader = (workspaceRoot: string) =>
  new DefinitionLoader(
    workspaceRoot,
    { env: assetPathEnv(workspaceRoot) }
  )

const getTargetDirectory = (workspaceRoot: string, kind: CreatableAssetKind) => {
  const pathEnv = assetPathEnv(workspaceRoot)
  const baseDir = resolveProjectOoBaseDir(workspaceRoot, pathEnv)
  return kind === 'entity'
    ? resolveProjectOoEntitiesDir(workspaceRoot, pathEnv)
    : resolve(baseDir, kind === 'spec' ? 'specs' : 'rules')
}

const getDefinitionNames = (definition: Definition<Entity | Rule | Spec>, kind: CreatableAssetKind) => {
  const identifier = kind === 'entity'
    ? resolveEntityIdentifier(definition.path, definition.attributes.name)
    : kind === 'spec'
    ? resolveSpecIdentifier(definition.path, definition.attributes.name)
    : definition.attributes.name?.trim() || basename(definition.path).replace(/\.md$/iu, '')
  const rawIdentifier = kind === 'entity'
    ? resolveEntityIdentifier(definition.path)
    : kind === 'spec'
    ? resolveSpecIdentifier(definition.path)
    : basename(definition.path).replace(/\.md$/iu, '')
  return [definition.attributes.name, definition.resolvedName, identifier, rawIdentifier].flatMap((name) => {
    if (name == null) return []
    return [name, name.split('/').at(-1) ?? name]
      .map(name => toCanonicalAssetSlug(name))
      .filter((slug): slug is string => slug != null)
  })
}

const loadDefinitions = (loader: DefinitionLoader, kind: CreatableAssetKind) => {
  if (kind === 'entity') return loader.loadDefaultEntities()
  if (kind === 'spec') return loader.loadDefaultSpecs()
  return loader.loadDefaultRules()
}

const assertSemanticAvailability = async (loader: DefinitionLoader, input: ValidatedCreateAssetInput) => {
  const definitions = await loadDefinitions(loader, input.kind)
  if (definitions.some(definition => getDefinitionNames(definition, input.kind).includes(input.slug))) {
    throw conflict('A data asset with this name already exists', { name: input.slug }, 'asset_name_exists')
  }
}

const createProjectAssetOwned = async (params: {
  input: unknown
  loader: DefinitionLoader
  publishOperations?: PublishOperations
  workspaceIdentity?: FileIdentity
  workspaceRoot: string
}): Promise<CreatedProjectAsset> => {
  const input = validateCreateAssetInput(params.input)
  const baseDir = resolveProjectOoBaseDir(params.workspaceRoot, assetPathEnv(params.workspaceRoot))
  const { directory, workspaceRoot } = await ensureSafeDirectory(
    params.workspaceRoot,
    getTargetDirectory(params.workspaceRoot, input.kind),
    params.workspaceIdentity
  )
  const claimAuthority = await inspectSafeDestination(
    params.workspaceRoot,
    resolve(baseDir),
    params.workspaceIdentity
  )
  const targetPath = resolve(directory, `${input.slug}.md`)
  if (dirname(targetPath) !== directory) throw conflict('Invalid asset path', undefined, 'invalid_asset_name')
  const release = await acquireAssetLock(claimAuthority.directory, `${input.kind}-${input.slug}`)
  const releaseClaim = async () => {
    try {
      return await release()
    } catch {
      return { degraded: true, released: false }
    }
  }
  let outcome: PublishOutcome
  try {
    await assertSemanticAvailability(params.loader, input)
    outcome = await safelyPublishFile({
      content: renderCreatedAsset(input),
      targetPath,
      workspaceIdentity: params.workspaceIdentity,
      workspaceRoot
    }, params.publishOperations)
  } catch (error) {
    const lockRelease = await releaseClaim()
    if (!lockRelease.released) {
      throw internalServerError('Asset claim cleanup status is indeterminate', {
        code: 'asset_claim_indeterminate',
        details: { committed: false }
      })
    }
    if (error instanceof Error && 'status' in error) throw error
    throw internalServerError('Failed to create data asset', { cause: error, code: 'asset_create_failed' })
  }
  let commitState = outcome.state
  const publishWarnings = new Set(outcome.warnings ?? [])
  const markDegraded = (warning: string) => {
    publishWarnings.add(warning)
    if (commitState === 'committed') commitState = 'committed-degraded'
  }
  const lockRelease = await releaseClaim()
  if (!lockRelease.released) markDegraded('asset_claim_release_failed')
  else if (lockRelease.degraded) markDegraded('asset_claim_release_not_durable')
  const warnings = Array.from(publishWarnings)
  return {
    kind: input.kind,
    path: relative(workspaceRoot, targetPath).split(sep).join('/'),
    ...(commitState === 'committed' ? {} : { commitState }),
    ...(warnings.length === 0 ? {} : { warnings })
  }
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
  const targetPath = resolve(getTargetDirectory(workspaceRoot, validated.kind), `${validated.slug}.md`)
  if (!isInsideWorkspace(workspaceRoot, targetPath)) {
    throw badRequest('Asset destination is outside the current workspace', undefined, 'asset_destination_forbidden')
  }
  const inspected = await inspectSafeDestination(workspaceRoot, dirname(targetPath), workspaceIdentity)
  const canonicalTargetPath = resolve(inspected.directory, basename(targetPath))
  return {
    kind: validated.kind,
    path: relative(inspected.workspaceRoot, canonicalTargetPath).split(sep).join('/')
  }
}

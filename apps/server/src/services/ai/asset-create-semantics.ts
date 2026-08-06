import { basename, relative, resolve, sep } from 'node:path'
import process from 'node:process'

import { resolveEntityIdentifier, resolveSpecIdentifier } from '@oneworks/definition-core'
import type { DefinitionLoader } from '@oneworks/definition-loader'
import type { Definition, Entity, Rule, Spec } from '@oneworks/types'
import { resolveProjectOoBaseDir, resolveProjectOoEntitiesDir } from '@oneworks/utils'
import { toCanonicalAssetSlug } from '@oneworks/utils/asset-slug'

import { badRequest, conflict } from '#~/utils/http.js'
import { isInsideWorkspace } from './asset-create-destination.js'
import type { CreatableAssetKind, ValidatedCreateAssetInput } from './asset-create-input.js'

export const getAssetTargetDirectory = (workspaceRoot: string, kind: CreatableAssetKind) => {
  const env = { ...process.env, __ONEWORKS_PROJECT_WORKSPACE_FOLDER__: workspaceRoot }
  const baseDir = resolveProjectOoBaseDir(workspaceRoot, env)
  return kind === 'entity'
    ? resolveProjectOoEntitiesDir(workspaceRoot, env)
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
  return [definition.attributes.name, definition.resolvedName, identifier, rawIdentifier].flatMap(name => {
    if (name == null) return []
    const segments = name.split('/')
    const scoped = segments.map(segment => toCanonicalAssetSlug(segment))
    return [
      toCanonicalAssetSlug(name),
      toCanonicalAssetSlug(segments.at(-1) ?? name),
      scoped.every((value): value is string => value != null) ? scoped.join('-') : undefined
    ]
  }).filter((value): value is string => value != null)
}
const loadDefinitions = (loader: DefinitionLoader, kind: CreatableAssetKind) =>
  kind === 'entity'
    ? loader.loadDefaultEntities()
    : kind === 'spec'
    ? loader.loadDefaultSpecs()
    : loader.loadDefaultRules()
export const assertAssetSemanticAvailability = async (loader: DefinitionLoader, input: ValidatedCreateAssetInput) => {
  const definitions = await loadDefinitions(loader, input.kind)
  if (definitions.some(definition => getDefinitionNames(definition, input.kind).includes(input.slug))) {
    throw conflict('A data asset with this name already exists', { name: input.slug }, 'asset_name_exists')
  }
}
export const getAssetPublication = (workspaceRoot: string, input: ValidatedCreateAssetInput) => {
  const directory = getAssetTargetDirectory(workspaceRoot, input.kind)
  const parent = relative(workspaceRoot, directory)
  const targetBasename = `${input.slug}.md`
  if (
    parent === '' || parent === '..' || parent.startsWith(`..${sep}`) ||
    parent.split(sep).some(segment => segment === '' || segment === '.' || segment === '..') ||
    !isInsideWorkspace(workspaceRoot, resolve(directory, targetBasename))
  ) throw badRequest('Asset destination is outside the current workspace', undefined, 'asset_destination_forbidden')
  return {
    basename: targetBasename,
    parentSegments: parent.split(sep),
    path: [...parent.split(sep), targetBasename].join('/')
  }
}

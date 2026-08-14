/* eslint-disable max-lines -- Standard document aliases, inheritance, fragments, and prompt envelope form one resolver. */
import { readFile } from 'node:fs/promises'
import { basename, dirname, extname, isAbsolute, relative, resolve } from 'node:path'

import type {
  EntityDocumentConfig,
  EntityDocumentKind,
  EntityInheritanceMode,
  WorkspaceAsset,
  WorkspaceAssetBundle
} from '@oneworks/types'
import fm from 'front-matter'

import { findNamedAsset, resolveEntityInheritance } from './selection-internal'

type EntityAsset = Extract<WorkspaceAsset, { kind: 'entity' }>

export interface ResolvedEntityDocumentFragment {
  body: string
  entity: string
  inherited: boolean
  path: string
  source: 'workspace' | 'plugin'
}

export interface ResolvedEntityDocument {
  body: string
  editable: boolean
  exists: boolean
  fragments: ResolvedEntityDocumentFragment[]
  inherit: EntityInheritanceMode
  kind: EntityDocumentKind
  localPath?: string
  title: string
}

export interface ResolvedEntityDocumentSet {
  assetIds: string[]
  definition: ReturnType<typeof resolveEntityInheritance>['definition']
  documents: ResolvedEntityDocument[]
  effectivePrompt: string
}

const DOCUMENT_SPECS: Array<{
  aliases: string[]
  defaultInherit: EntityInheritanceMode
  fileName: string
  kind: EntityDocumentKind
  title: string
}> = [
  { kind: 'identity', title: 'Identity', fileName: 'IDENTITY.md', aliases: [], defaultInherit: 'replace' },
  {
    kind: 'soul',
    title: 'Soul',
    fileName: 'SOUL.md',
    aliases: ['PERSONALITY.md', 'personality.md', '人格.md'],
    defaultInherit: 'append'
  },
  { kind: 'role', title: 'Role', fileName: 'ROLE.md', aliases: [], defaultInherit: 'append' },
  { kind: 'operations', title: 'Operations', fileName: 'OPERATIONS.md', aliases: [], defaultInherit: 'append' },
  { kind: 'tools', title: 'Tool guidance', fileName: 'TOOLS.md', aliases: [], defaultInherit: 'append' },
  {
    kind: 'knowledge',
    title: 'Knowledge',
    fileName: 'KNOWLEDGE.md',
    aliases: ['INTRODUCTION.md', 'introduction.md', '介绍.md'],
    defaultInherit: 'append'
  },
  { kind: 'memoryPolicy', title: 'Memory policy', fileName: 'MEMORY_POLICY.md', aliases: [], defaultInherit: 'append' },
  {
    kind: 'memory',
    title: 'Curated memory',
    fileName: 'MEMORY.md',
    aliases: ['memory.md', '记忆.md'],
    defaultInherit: 'append'
  }
]

const isMissingFile = (error: unknown) => (
  error != null && typeof error === 'object' && 'code' in error &&
  (error as { code?: unknown }).code === 'ENOENT'
)

const readOptionalMarkdown = async (path: string) => {
  try {
    return fm<Record<string, unknown>>(await readFile(path, 'utf8')).body.trim()
  } catch (error) {
    if (isMissingFile(error)) return undefined
    throw error
  }
}

const isDirectoryEntity = (path: string) => ['readme.md', 'index.json'].includes(basename(path).toLowerCase())

const resolveEntityDocumentPath = (root: string, value: string) => {
  const path = resolve(root, value)
  const relativePath = relative(root, path)
  if (
    value.trim() === '' || isAbsolute(value) || relativePath.startsWith('..') || isAbsolute(relativePath) ||
    extname(path).toLowerCase() !== '.md'
  ) {
    throw new Error(`Entity document path must be a Markdown file inside the entity directory: ${value}`)
  }
  return path
}

const normalizeDocumentConfig = (
  value: string | EntityDocumentConfig | undefined,
  defaultPath: string,
  defaultInherit: EntityInheritanceMode
) => ({
  inherit: typeof value === 'object' && value?.inherit != null ? value.inherit : defaultInherit,
  path: typeof value === 'string' ? value : value?.path ?? defaultPath
})

const resolveLocalDocument = async (
  asset: EntityAsset,
  kind: EntityDocumentKind,
  fileName: string,
  aliases: string[]
) => {
  const definition = asset.payload.definition
  const root = dirname(definition.path)
  const configured = normalizeDocumentConfig(definition.attributes.documents?.[kind], fileName, 'append')
  const candidates = [configured.path, ...(definition.attributes.documents?.[kind] == null ? aliases : [])]
  for (const candidate of candidates) {
    const path = resolveEntityDocumentPath(root, candidate)
    const body = await readOptionalMarkdown(path)
    if (body != null && body !== '') return { body, path }
  }

  if (kind === 'role' && definition.body.trim() !== '') {
    return { body: definition.body.trim(), path: definition.path }
  }
  return undefined
}

const mergeFragments = (
  existing: ResolvedEntityDocumentFragment[],
  incoming: ResolvedEntityDocumentFragment[],
  mode: EntityInheritanceMode
) => {
  if (mode === 'none') return incoming
  if (mode === 'replace') return incoming.length > 0 ? incoming : existing
  if (incoming.length === 0) return existing
  if (existing.length === 0) return incoming
  return mode === 'prepend' ? [...incoming, ...existing] : [...existing, ...incoming]
}

export const resolveEntityDocumentSet = async (
  bundle: WorkspaceAssetBundle,
  asset: EntityAsset
): Promise<ResolvedEntityDocumentSet> => {
  const effective = resolveEntityInheritance(bundle, asset)

  const resolveAssetDocuments = async (
    current: EntityAsset,
    stack: EntityAsset[]
  ): Promise<Map<EntityDocumentKind, ResolvedEntityDocumentFragment[]>> => {
    if (stack.some(item => item.id === current.id)) {
      throw new Error(`Circular entity document inheritance at ${current.displayName}`)
    }
    const inherited = new Map<EntityDocumentKind, ResolvedEntityDocumentFragment[]>()
    const refs = typeof current.payload.definition.attributes.extends === 'string'
      ? [current.payload.definition.attributes.extends]
      : current.payload.definition.attributes.extends ?? []
    for (const ref of refs) {
      const parent = findNamedAsset(bundle.entities, ref, current.instancePath)
      if (parent == null) continue
      const parentDocuments = await resolveAssetDocuments(parent, [...stack, current])
      for (const spec of DOCUMENT_SPECS) {
        inherited.set(spec.kind, [
          ...(inherited.get(spec.kind) ?? []),
          ...(parentDocuments.get(spec.kind) ?? [])
        ])
      }
    }

    for (const spec of DOCUMENT_SPECS) {
      const local = await resolveLocalDocument(current, spec.kind, spec.fileName, spec.aliases)
      const configured = normalizeDocumentConfig(
        current.payload.definition.attributes.documents?.[spec.kind],
        spec.fileName,
        spec.defaultInherit
      )
      const fragments = local == null ? [] : [
        {
          body: local.body,
          entity: current.displayName,
          inherited: current.id !== asset.id,
          path: local.path,
          source: current.origin
        } satisfies ResolvedEntityDocumentFragment
      ]
      inherited.set(spec.kind, mergeFragments(inherited.get(spec.kind) ?? [], fragments, configured.inherit))
    }
    return inherited
  }

  const fragmentsByKind = await resolveAssetDocuments(asset, [])
  const documents = DOCUMENT_SPECS.map(spec => {
    const fragments = fragmentsByKind.get(spec.kind) ?? []
    const localFragment = [...fragments].reverse().find(fragment => !fragment.inherited)
    const config = normalizeDocumentConfig(
      asset.payload.definition.attributes.documents?.[spec.kind],
      spec.fileName,
      spec.defaultInherit
    )
    const canEdit = asset.origin === 'workspace' && isDirectoryEntity(asset.payload.definition.path)
    const configuredLocalPath = canEdit
      ? resolveEntityDocumentPath(dirname(asset.payload.definition.path), config.path)
      : undefined
    const usesEntryFallback = spec.kind === 'role' && localFragment?.path === asset.payload.definition.path &&
      configuredLocalPath !== asset.payload.definition.path
    return {
      body: fragments.map(fragment => fragment.body).filter(Boolean).join('\n\n'),
      editable: canEdit,
      exists: localFragment != null && !usesEntryFallback,
      fragments,
      inherit: config.inherit,
      kind: spec.kind,
      localPath: usesEntryFallback ? configuredLocalPath : localFragment?.path ?? configuredLocalPath,
      title: spec.title
    } satisfies ResolvedEntityDocument
  })
  const effectivePrompt = [
    `<entity-context entity="${asset.displayName}">`,
    ...documents.flatMap(document =>
      document.body === '' ? [] : [
        `<entity-document kind="${document.kind}">`,
        document.body,
        '</entity-document>'
      ]
    ),
    '</entity-context>'
  ].join('\n\n')

  return {
    assetIds: effective.assetIds,
    definition: effective.definition,
    documents,
    effectivePrompt
  }
}

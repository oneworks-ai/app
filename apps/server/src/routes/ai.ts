/* eslint-disable max-lines -- AI asset routes share one DefinitionLoader and preserve the existing public route surface. */
import { randomUUID } from 'node:crypto'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from 'node:path'
import process from 'node:process'

import Router from '@koa/router'

import { formatConfigValueAsYaml, updateConfigFile } from '@oneworks/config'
import { resolveEntityIdentifier } from '@oneworks/definition-core'
import { DefinitionLoader } from '@oneworks/definition-loader'
import type { Definition, Entity, EntityRuntimeChannelAccount, EntityRuntimeDetail, Rule, Spec } from '@oneworks/types'

import { getDb } from '#~/db/index.js'
import { loadConfigState } from '#~/services/config/index.js'
import { badRequest, forbidden, internalServerError, isHttpError, notFound } from '#~/utils/http.js'
import { registerAiAssetCreateRoutes } from './ai-asset-create-routes.js'
import type { AiAssetCreateRouteOptions } from './ai-asset-create-routes.js'
import {
  matchesDefinitionPath,
  presentEntity,
  presentEntityDetail,
  presentRule,
  presentRuleDetail,
  presentSpec,
  presentSpecDetail,
  presentWorkspace
} from './ai-presenters.js'
import { registerAiSkillRoutes } from './ai-skill-routes.js'

export interface AiRouterOptions extends AiAssetCreateRouteOptions {}

const isRecord = (value: unknown): value is Record<string, unknown> => (
  value != null && typeof value === 'object' && !Array.isArray(value)
)

const toStringArray = (value: unknown) => (
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
)

const presentFilter = (value: unknown) => {
  if (!isRecord(value)) return { exclude: [], include: [] }
  return {
    exclude: toStringArray(value.exclude),
    include: toStringArray(value.include)
  }
}

const presentSkillSelection = (value: Entity['skills']) => {
  if (Array.isArray(value)) return { exclude: [], include: value }
  if (value?.type === 'exclude') return { exclude: value.list, include: [] }
  return { exclude: [], include: value?.list ?? [] }
}

const entityConfigSchema = {
  type: 'object',
  properties: {
    runtime: {
      type: 'object',
      title: '运行时',
      description: '实体在未被频道路由覆盖时使用的 adapter、模型服务和模型。',
      properties: {
        adapter: { type: 'string', title: 'Adapter' },
        modelService: { type: 'string', title: '模型服务' },
        model: { type: 'string', title: '模型' }
      }
    },
    extends: {
      type: 'array',
      items: { type: 'string' },
      title: '组合实体',
      description: '当前实体组合的父实体。未填写时独立运行。',
      'x-oneworks-ui': { icon: 'account_tree' }
    },
    inherit: {
      type: 'object',
      title: '继承策略',
      description: '控制提示词、技能、工具等字段如何与父实体合并。',
      'x-oneworks-ui': { control: 'json', icon: 'merge' }
    },
    skills: {
      type: 'object',
      title: '技能策略',
      description: '当前实体默认装载或屏蔽的技能。',
      properties: {
        type: {
          type: 'string',
          enum: ['include', 'exclude'],
          enumNames: ['只装载这些技能', '屏蔽这些技能'],
          title: '策略'
        },
        list: { type: 'array', items: { type: 'string' }, title: '技能列表' }
      }
    },
    tools: {
      type: 'object',
      title: '工具策略',
      description: '当前实体允许或屏蔽的工具。',
      properties: {
        include: { type: 'array', items: { type: 'string' }, title: '允许工具' },
        exclude: { type: 'array', items: { type: 'string' }, title: '屏蔽工具' }
      }
    },
    mcpServers: {
      type: 'object',
      title: 'MCP 服务',
      description: '当前实体允许或屏蔽的 MCP 服务。',
      properties: {
        include: { type: 'array', items: { type: 'string' }, title: '启用服务' },
        exclude: { type: 'array', items: { type: 'string' }, title: '屏蔽服务' }
      }
    },
    plugins: {
      type: 'object',
      title: '插件覆盖',
      description: '当前实体相对项目插件列表的覆盖配置。',
      'x-oneworks-ui': { control: 'json', icon: 'deployed_code' }
    },
    documents: {
      type: 'object',
      title: '文档组合',
      description: '标准实体文档的路径与继承方式。路径必须位于实体目录内。',
      'x-oneworks-ui': { control: 'json', icon: 'docs' }
    },
    memory: {
      type: 'object',
      title: '记忆装载策略',
      description: '约束候选规模、整轮预算和每个可见性 group 的预算。',
      properties: {
        maxCandidatesPerTurn: { type: 'integer', title: '每轮最大候选数' },
        maxItemsPerTurn: { type: 'integer', title: '每轮最大记忆数' },
        maxTokensPerTurn: { type: 'integer', title: '每轮最大 Token' },
        maxItemsPerGroup: { type: 'integer', title: '每个 Group 最大记忆数' },
        maxTokensPerGroup: { type: 'integer', title: '每个 Group 最大 Token' },
        defaultTtlSeconds: { type: 'integer', title: '默认有效期（秒）' },
        requireEvidence: { type: 'boolean', title: '写入必须保留依据' },
        allowSensitive: { type: 'boolean', title: '允许敏感记忆' },
        writableScopes: { type: 'array', items: { type: 'string' }, title: '允许写入的作用域' }
      }
    }
  }
} as const

const editableEntityConfigKeys = [
  'extends',
  'inherit',
  'skills',
  'tools',
  'mcpServers',
  'plugins',
  'runtime',
  'documents',
  'memory'
] as const

const entityDocumentTemplates = {
  identity: '# 身份\n\n',
  soul: '# 性格与价值观\n\n',
  role: '# 角色\n\n',
  operations: '# 工作方式\n\n',
  tools: '# 工具使用约定\n\n',
  knowledge: '# 知识边界\n\n',
  memoryPolicy: '# 记忆策略\n\n',
  memory: '# 置顶记忆\n\n'
} as const

type EntityDocumentTemplateKind = keyof typeof entityDocumentTemplates

const presentEntityConfigOverrides = (attributes: Entity) => {
  const result: Record<string, unknown> = {}
  for (const key of editableEntityConfigKeys) {
    const value = attributes[key]
    if (value === undefined) continue
    result[key] = key === 'extends' && typeof value === 'string'
      ? [value]
      : key === 'skills' && Array.isArray(value)
      ? { type: 'include', list: value }
      : value
  }
  return result
}

const normalizeEntityConfigOverrides = (value: unknown) => {
  if (!isRecord(value)) throw badRequest('Invalid entity config', undefined, 'invalid_entity_config')
  const result: Record<string, unknown> = {}
  for (const key of editableEntityConfigKeys) {
    const fieldValue = value[key]
    if (fieldValue === undefined) continue
    if (key === 'skills' && isRecord(fieldValue)) {
      const type = fieldValue.type
      const list = fieldValue.list
      if ((type !== 'include' && type !== 'exclude') || !Array.isArray(list)) {
        throw badRequest('Invalid entity skill selection', undefined, 'invalid_entity_skills')
      }
      result[key] = {
        type,
        list: list.filter((item): item is string => typeof item === 'string')
      }
      continue
    }
    result[key] = fieldValue
  }
  return result
}

const serializeEntityMarkdown = (attributes: Entity, body: string) => (
  `---\n${formatConfigValueAsYaml(attributes)}---${body.startsWith('\n') ? '' : '\n'}${body}`
)

const serializeEntityConfig = (path: string, attributes: Entity, body: string) => (
  extname(path).toLowerCase() === '.json'
    ? `${JSON.stringify(attributes, null, 2)}\n`
    : serializeEntityMarkdown(attributes, body)
)

const toWorkspacePath = (workspaceRoot: string, path: string | undefined) => {
  if (path == null) return undefined
  const value = relative(workspaceRoot, path)
  return value === '' || value.startsWith('..') || isAbsolute(value) ? undefined : value
}

const resolveEntityConfigPath = (entityPath: string) => (
  basename(entityPath).toLowerCase() === 'readme.md'
    ? join(dirname(entityPath), 'entity.yaml')
    : entityPath
)

const isEditableMemory = (memory: ReturnType<ReturnType<typeof getDb>['getChannelMemory']>) => (
  memory != null &&
  memory.source?.issuer === 'oneworks' &&
  memory.metadata?.sourceChildRunId == null &&
  memory.metadata?.sourceMessageId == null &&
  !memory.id.startsWith('channel_memory_file_')
)

const getMemoryReadOnlyReason = (memory: NonNullable<ReturnType<ReturnType<typeof getDb>['getChannelMemory']>>) => {
  if (memory.id.startsWith('channel_memory_file_')) return 'file_synced'
  if (memory.metadata?.sourceChildRunId != null || memory.metadata?.sourceMessageId != null) return 'runtime_generated'
  if (memory.source?.issuer !== 'oneworks') return 'external_source'
  return undefined
}

const getChannelConfigSource = (
  channelKey: string,
  configState: Awaited<ReturnType<typeof loadConfigState>>
) => {
  const sources = [
    ['user', configState.userSource],
    ['project', configState.projectSource],
    ['global', configState.globalSource]
  ] as const
  return sources.find(([, source]) => (
    isRecord(source?.resolvedConfig?.channels) && channelKey in source.resolvedConfig.channels
  ))
}

export function aiRouter(options: AiRouterOptions = {}): Router {
  const router = new Router()
  const workspaceRoot = process.env.WORKSPACE_FOLDER || process.cwd()
  const loader = new DefinitionLoader(workspaceRoot)
  registerAiAssetCreateRoutes(router, options)

  router.get('/specs', async (ctx) => {
    try {
      const specs = await loader.loadDefaultSpecs()
      ctx.body = {
        specs: specs.map((spec: Definition<Spec>) => presentSpec(spec, workspaceRoot))
      }
    } catch (err) {
      throw internalServerError('Failed to load specs', { cause: err, code: 'ai_specs_load_failed' })
    }
  })

  registerAiSkillRoutes(router, {
    loader,
    workspaceRoot
  })

  router.get('/specs/detail', async (ctx) => {
    const targetPath = typeof ctx.query.path === 'string' ? ctx.query.path : undefined
    if (!targetPath) {
      throw badRequest('Missing path', undefined, 'missing_path')
    }

    try {
      const specs = await loader.loadDefaultSpecs()
      const spec = specs.find((item: Definition<Spec>) => matchesDefinitionPath(item, targetPath, workspaceRoot))

      if (!spec) {
        throw notFound('Spec not found', { path: targetPath }, 'spec_not_found')
      }

      ctx.body = {
        spec: presentSpecDetail(spec, workspaceRoot)
      }
    } catch (err) {
      if (isHttpError(err)) throw err
      throw internalServerError('Failed to load spec detail', { cause: err, code: 'ai_spec_detail_load_failed' })
    }
  })

  router.get('/entities', async (ctx) => {
    try {
      const entities = await loader.loadDefaultEntities()
      ctx.body = {
        entities: entities.map((entity: Definition<Entity>) => presentEntity(entity, workspaceRoot))
      }
    } catch (err) {
      throw internalServerError('Failed to load entities', { cause: err, code: 'ai_entities_load_failed' })
    }
  })

  router.get('/workspaces', async (ctx) => {
    try {
      const workspaces = await loader.loadWorkspaces()
      ctx.body = {
        workspaces: workspaces.map(presentWorkspace)
      }
    } catch (err) {
      throw internalServerError('Failed to load workspaces', { cause: err, code: 'ai_workspaces_load_failed' })
    }
  })

  router.get('/rules', async (ctx) => {
    try {
      const rules = await loader.loadDefaultRules()
      ctx.body = {
        rules: rules.map((rule: Definition<Rule>) => presentRule(rule, workspaceRoot))
      }
    } catch (err) {
      throw internalServerError('Failed to load rules', { cause: err, code: 'ai_rules_load_failed' })
    }
  })

  router.get('/rules/detail', async (ctx) => {
    const targetPath = typeof ctx.query.path === 'string' ? ctx.query.path : undefined
    if (!targetPath) {
      throw badRequest('Missing path', undefined, 'missing_path')
    }

    try {
      const rules = await loader.loadDefaultRules()
      const rule = rules.find((item: Definition<Rule>) => matchesDefinitionPath(item, targetPath, workspaceRoot))

      if (!rule) {
        throw notFound('Rule not found', { path: targetPath }, 'rule_not_found')
      }

      ctx.body = {
        rule: presentRuleDetail(rule, workspaceRoot)
      }
    } catch (err) {
      if (isHttpError(err)) throw err
      throw internalServerError('Failed to load rule detail', { cause: err, code: 'ai_rule_detail_load_failed' })
    }
  })

  router.get('/entities/detail', async (ctx) => {
    const targetPath = typeof ctx.query.path === 'string' ? ctx.query.path : undefined
    if (!targetPath) {
      throw badRequest('Missing path', undefined, 'missing_path')
    }

    try {
      const entities = await loader.loadDefaultEntities()
      const entity = entities.find((item: Definition<Entity>) => matchesDefinitionPath(item, targetPath, workspaceRoot))

      if (!entity) {
        throw notFound('Entity not found', { path: targetPath }, 'entity_not_found')
      }

      ctx.body = {
        entity: presentEntityDetail(entity, workspaceRoot)
      }
    } catch (err) {
      if (isHttpError(err)) throw err
      throw internalServerError('Failed to load entity detail', { cause: err, code: 'ai_entity_detail_load_failed' })
    }
  })

  router.get('/entities/runtime', async (ctx) => {
    const targetPath = typeof ctx.query.path === 'string' ? ctx.query.path : undefined
    if (!targetPath) throw badRequest('Missing path', undefined, 'missing_path')

    try {
      const [entities, channelLinks, configState] = await Promise.all([
        loader.loadDefaultEntities(),
        loader.loadDefaultChannelLinks(),
        loadConfigState(workspaceRoot)
      ])
      const entity = entities.find((item: Definition<Entity>) => matchesDefinitionPath(item, targetPath, workspaceRoot))
      if (!entity) throw notFound('Entity not found', { path: targetPath }, 'entity_not_found')

      const presented = presentEntity(entity, workspaceRoot)
      const documentSet = await loader.loadEntityDocumentSet(
        resolveEntityIdentifier(entity.path, entity.attributes.name)
      )
      const effectiveEntity = documentSet?.definition.attributes ?? entity.attributes
      const entityNames = new Set([
        presented.name,
        entity.resolvedName,
        entity.attributes.name
      ].filter((value): value is string => typeof value === 'string' && value.trim() !== ''))
      const links = channelLinks
        .filter(link => entityNames.has(link.attributes.entity.trim()))
        .map(link => {
          const externalId = Object.entries(link.attributes.external)
            .find(([key, value]) => key !== 'type' && typeof value === 'string')?.[1]
          return {
            channelKey: link.attributes.channel,
            description: link.attributes.description ?? '',
            editable: link.resolvedSource === 'project',
            externalId: typeof externalId === 'string' ? externalId : undefined,
            externalType: link.attributes.external.type,
            ingress: link.attributes.ingress ?? {},
            memoryScope: link.attributes.memoryScope,
            name: link.attributes.name ?? link.resolvedName ?? relative(workspaceRoot, link.path),
            path: relative(workspaceRoot, link.path),
            routing: link.attributes.routing ?? {}
          }
        })
      const linkedChannelKeys = new Set(links.map(link => link.channelKey))
      const channelOwners = new Map<string, Set<string>>()
      for (const link of channelLinks) {
        const owners = channelOwners.get(link.attributes.channel) ?? new Set<string>()
        owners.add(link.attributes.entity.trim())
        channelOwners.set(link.attributes.channel, owners)
      }
      const presentChannelAccount = (channelKey: string): EntityRuntimeChannelAccount => {
        const config = isRecord(configState.mergedConfig.channels?.[channelKey])
          ? configState.mergedConfig.channels[channelKey]
          : {}
        const source = getChannelConfigSource(channelKey, configState)
        const type = typeof config.type === 'string'
          ? config.type
          : links.find(link => link.channelKey === channelKey)?.externalType ?? 'unknown'
        return {
          bindingCount: links.filter(link => link.channelKey === channelKey).length,
          channelKey,
          configPath: source?.[1]?.configPath == null
            ? undefined
            : relative(workspaceRoot, source[1].configPath),
          configSource: source?.[0] ?? 'effective',
          description: typeof config.description === 'string' ? config.description : '',
          enabled: config.enabled !== false,
          title: typeof config.title === 'string' && config.title.trim() !== ''
            ? config.title
            : channelKey,
          type
        }
      }
      const channelAccounts = [...linkedChannelKeys].map(presentChannelAccount)
      const availableChannelAccounts = Object.keys(configState.mergedConfig.channels ?? {})
        .filter(channelKey => {
          if (linkedChannelKeys.has(channelKey)) return false
          const owners = channelOwners.get(channelKey)
          return owners == null || [...owners].every(owner => entityNames.has(owner))
        })
        .map(presentChannelAccount)
      const entityIds = new Set([
        ...entityNames,
        resolveEntityIdentifier(entity.path, entity.attributes.name)
      ])
      const rooms = getDb().listAgentRooms('all').flatMap(room => {
        const detail = getDb().getAgentRoomDetail(room.id)
        if (detail == null || !detail.members.some(member => entityIds.has(member.key))) return []
        return [{
          archived: room.archivedAt != null,
          id: room.id,
          members: detail.members.map(member => ({
            avatar: member.avatar,
            key: member.key,
            label: member.label
          })),
          status: room.status,
          title: room.title,
          updatedAt: room.updatedAt
        }]
      })
      const memoryNames = [...entityNames]
      const memories = memoryNames
        .flatMap(name => getDb().listChannelMemoriesByEntity(name))
        .filter((memory, index, items) => items.findIndex(item => item.id === memory.id) === index)
        .map(memory => ({
          confidence: memory.confidence,
          content: memory.content,
          expiresAt: memory.expiresAt,
          id: memory.id,
          importance: memory.importance,
          keywords: memory.keywords,
          pinned: memory.pinned,
          sensitivity: memory.sensitivity,
          source: memory.source,
          subjectId: memory.subjectId,
          subjectType: memory.subjectType,
          visibility: memory.visibility,
          editable: isEditableMemory(memory),
          readOnlyReason: getMemoryReadOnlyReason(memory),
          updatedAt: memory.updatedAt
        }))

      const runtime = {
        availableChannelAccounts,
        channelAccounts,
        channelLinks: links,
        entityConfig: {
          editable: entity.resolvedSource === 'project',
          extends: typeof entity.attributes.extends === 'string'
            ? [entity.attributes.extends]
            : entity.attributes.extends ?? [],
          inherit: entity.attributes.inherit,
          mcpServers: presentFilter(entity.attributes.mcpServers),
          plugins: entity.attributes.plugins,
          jsonSchema: entityConfigSchema,
          skills: presentSkillSelection(entity.attributes.skills),
          tools: presentFilter(entity.attributes.tools),
          overrides: presentEntityConfigOverrides(entity.attributes),
          effective: presentEntityConfigOverrides(effectiveEntity),
          path: toWorkspacePath(workspaceRoot, resolveEntityConfigPath(entity.path))
        },
        documents: documentSet?.documents.map(document => ({
          body: document.body,
          editable: document.editable,
          exists: document.exists,
          fragments: document.fragments.map(fragment => ({
            body: fragment.body,
            entity: fragment.entity,
            inherited: fragment.inherited,
            path: toWorkspacePath(workspaceRoot, fragment.path),
            source: fragment.source
          })),
          inherit: document.inherit,
          kind: document.kind,
          path: toWorkspacePath(workspaceRoot, document.localPath),
          title: document.title
        })) ?? [],
        effectiveContext: {
          body: documentSet?.effectivePrompt ?? entity.body,
          sectionCount: documentSet?.documents.filter(document => document.body !== '').length ?? 1,
          sourceCount: new Set(
            documentSet?.documents.flatMap(document => (
              document.fragments.map(fragment => fragment.path)
            )) ?? [entity.path]
          ).size
        },
        entityPath: relative(workspaceRoot, entity.path),
        memoryPolicy: {
          config: effectiveEntity.memory ?? {},
          groupDimensions: ['conversationTypes', 'entities', 'orgs', 'rooms', 'channels'],
          loading: {
            requiredGroups: ['orgs'],
            sameGroup: 'or',
            crossGroup: 'and'
          }
        },
        memories,
        modelDefaults: {
          adapter: configState.mergedConfig.defaultAdapter,
          model: configState.mergedConfig.defaultModel,
          modelService: configState.mergedConfig.defaultModelService,
          projectConfigPath: configState.projectSource?.configPath == null
            ? undefined
            : relative(workspaceRoot, configState.projectSource.configPath)
        },
        rooms
      } satisfies EntityRuntimeDetail
      ctx.body = { runtime }
    } catch (err) {
      if (isHttpError(err)) throw err
      throw internalServerError('Failed to load entity runtime', {
        cause: err,
        code: 'ai_entity_runtime_load_failed'
      })
    }
  })

  router.patch('/entities/config', async (ctx) => {
    const body = ctx.request.body as { path?: unknown; value?: unknown }
    if (typeof body.path !== 'string' || body.path.trim() === '') {
      throw badRequest('Missing entity path', undefined, 'missing_entity_path')
    }

    try {
      const entities = await loader.loadDefaultEntities()
      const entity = entities.find(item => matchesDefinitionPath(item, body.path as string, workspaceRoot))
      if (entity == null) throw notFound('Entity not found', { path: body.path }, 'entity_not_found')
      if (entity.resolvedSource !== 'project') {
        throw forbidden('Plugin entities cannot be edited from this workspace', undefined, 'entity_not_editable')
      }

      const overrides = normalizeEntityConfigOverrides(body.value)
      const nextAttributes = { ...entity.attributes } as Record<string, unknown>
      for (const key of editableEntityConfigKeys) delete nextAttributes[key]
      Object.assign(nextAttributes, overrides)
      const configPath = resolveEntityConfigPath(entity.path)
      if (configPath === entity.path) {
        await writeFile(entity.path, serializeEntityConfig(entity.path, nextAttributes as Entity, entity.body), 'utf8')
      } else {
        await writeFile(configPath, formatConfigValueAsYaml(nextAttributes), 'utf8')
      }
      ctx.body = { ok: true }
    } catch (err) {
      if (isHttpError(err)) throw err
      throw internalServerError('Failed to update entity config', {
        cause: err,
        code: 'ai_entity_config_update_failed'
      })
    }
  })

  router.post('/entities/documents', async (ctx) => {
    const body = ctx.request.body as { entityPath?: unknown; kind?: unknown }
    if (typeof body.entityPath !== 'string' || body.entityPath.trim() === '') {
      throw badRequest('Missing entity path', undefined, 'missing_entity_path')
    }
    if (typeof body.kind !== 'string' || !(body.kind in entityDocumentTemplates)) {
      throw badRequest('Invalid entity document kind', undefined, 'invalid_entity_document_kind')
    }

    try {
      const entities = await loader.loadDefaultEntities()
      const entity = entities.find(item => matchesDefinitionPath(item, body.entityPath as string, workspaceRoot))
      if (entity == null) throw notFound('Entity not found', { path: body.entityPath }, 'entity_not_found')
      if (entity.resolvedSource !== 'project' || basename(entity.path).toLowerCase() !== 'readme.md') {
        throw forbidden('This entity does not support document creation', undefined, 'entity_document_not_editable')
      }
      const documentSet = await loader.loadEntityDocumentSet(
        resolveEntityIdentifier(entity.path, entity.attributes.name)
      )
      const document = documentSet?.documents.find(item => item.kind === body.kind)
      if (document?.localPath == null) {
        throw badRequest('Entity document path is unavailable', undefined, 'entity_document_path_unavailable')
      }
      const entityRoot = dirname(entity.path)
      const documentPath = resolve(document.localPath)
      const relativePath = relative(entityRoot, documentPath)
      if (relativePath.startsWith('..') || isAbsolute(relativePath)) {
        throw forbidden(
          'Entity document must stay inside the entity directory',
          undefined,
          'entity_document_outside_root'
        )
      }
      await writeFile(
        documentPath,
        entityDocumentTemplates[body.kind as EntityDocumentTemplateKind],
        { encoding: 'utf8', flag: 'wx' }
      ).catch(error => {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      })
      ctx.body = { ok: true, path: relative(workspaceRoot, documentPath) }
    } catch (err) {
      if (isHttpError(err)) throw err
      throw internalServerError('Failed to create entity document', {
        cause: err,
        code: 'ai_entity_document_create_failed'
      })
    }
  })

  router.patch('/entities/memories/:memoryId', async (ctx) => {
    const memoryId = ctx.params.memoryId
    const body = ctx.request.body as { content?: unknown; keywords?: unknown; pinned?: unknown }
    const memory = getDb().getChannelMemory(memoryId)
    if (memory == null) throw notFound('Memory not found', { memoryId }, 'memory_not_found')
    if (!isEditableMemory(memory) || memory.source == null) {
      throw forbidden('This memory is managed by its source', {
        reason: getMemoryReadOnlyReason(memory)
      }, 'memory_not_editable')
    }
    if (body.content !== undefined && (typeof body.content !== 'string' || body.content.trim() === '')) {
      throw badRequest('Memory content must not be empty', undefined, 'invalid_memory_content')
    }
    if (body.keywords !== undefined && !Array.isArray(body.keywords)) {
      throw badRequest('Memory keywords must be an array', undefined, 'invalid_memory_keywords')
    }
    if (body.pinned !== undefined && typeof body.pinned !== 'boolean') {
      throw badRequest('Memory pinned must be a boolean', undefined, 'invalid_memory_pinned')
    }

    const keywords = body.keywords === undefined
      ? memory.keywords
      : body.keywords.filter((item): item is string => typeof item === 'string')
        .map(item => item.trim()).filter(Boolean)
    const updated = getDb().upsertChannelMemory({
      accountId: memory.accountId ?? undefined,
      canonicalUserId: memory.canonicalUserId ?? undefined,
      confidence: memory.confidence,
      content: typeof body.content === 'string' ? body.content.trim() : memory.content,
      entity: memory.entity ?? undefined,
      expiresAt: memory.expiresAt ?? undefined,
      id: memory.id,
      importance: memory.importance,
      issuer: memory.issuer,
      keywords,
      metadata: memory.metadata ?? undefined,
      orgId: memory.orgId,
      pinned: typeof body.pinned === 'boolean' ? body.pinned : memory.pinned,
      roomId: memory.roomId ?? undefined,
      sensitivity: memory.sensitivity,
      source: memory.source,
      subjectId: memory.subjectId,
      subjectType: memory.subjectType,
      threadKey: memory.threadKey ?? undefined,
      visibility: memory.visibility ?? undefined
    })
    ctx.body = { memory: updated }
  })

  router.patch('/entities/channel-accounts/:channelKey', async (ctx) => {
    const channelKey = ctx.params.channelKey
    const body = ctx.request.body as { enabled?: unknown }
    if (typeof body.enabled !== 'boolean') {
      throw badRequest('Enabled must be a boolean', undefined, 'invalid_channel_enabled')
    }
    const configState = await loadConfigState(workspaceRoot)
    const source = getChannelConfigSource(channelKey, configState)?.[0]
    if (source == null) throw notFound('Channel account not found', { channelKey }, 'channel_not_found')
    await updateConfigFile({
      workspaceFolder: workspaceRoot,
      source,
      section: 'channels',
      resolveValue: current => {
        const channels = isRecord(current.channels) ? current.channels : {}
        const account = isRecord(channels[channelKey]) ? channels[channelKey] : {}
        return { ...channels, [channelKey]: { ...account, enabled: body.enabled } }
      }
    })
    ctx.body = { ok: true }
  })

  router.post('/entities/channel-links', async (ctx) => {
    const body = ctx.request.body as {
      channelKey?: unknown
      description?: unknown
      entityPath?: unknown
      externalId?: unknown
      externalType?: unknown
      name?: unknown
    }
    if (
      typeof body.channelKey !== 'string' || body.channelKey.trim() === '' ||
      typeof body.entityPath !== 'string' || body.entityPath.trim() === '' ||
      typeof body.externalId !== 'string' || body.externalId.trim() === '' ||
      typeof body.externalType !== 'string' || body.externalType.trim() === '' ||
      typeof body.name !== 'string' || body.name.trim() === ''
    ) {
      throw badRequest('Incomplete channel association', undefined, 'invalid_channel_association')
    }
    const [entities, channelLinks, configState] = await Promise.all([
      loader.loadDefaultEntities(),
      loader.loadDefaultChannelLinks(),
      loadConfigState(workspaceRoot)
    ])
    const entity = entities.find(item => matchesDefinitionPath(item, body.entityPath as string, workspaceRoot))
    if (entity == null) throw notFound('Entity not found', undefined, 'entity_not_found')
    const channelKey = body.channelKey
    const externalType = body.externalType.trim()
    const externalId = body.externalId.trim()
    if (!isRecord(configState.mergedConfig.channels?.[channelKey])) {
      throw notFound('Channel account not found', undefined, 'channel_not_found')
    }
    const entityName = resolveEntityIdentifier(entity.path, entity.attributes.name)
    const entityNames = new Set([
      entityName,
      entity.resolvedName,
      entity.attributes.name
    ].filter((value): value is string => typeof value === 'string' && value.trim() !== ''))
    const conflicting = channelLinks.find(link => (
      link.attributes.channel === channelKey && !entityNames.has(link.attributes.entity.trim())
    ))
    if (conflicting != null) {
      throw badRequest('Channel account already belongs to another entity', {
        entity: conflicting.attributes.entity
      }, 'channel_owned_by_other_entity')
    }

    const account = configState.mergedConfig.channels[channelKey]
    const channelType = isRecord(account) && typeof account.type === 'string' ? account.type : 'unknown'
    const externalIdKey = channelType === 'oneworks'
      ? externalType === 'direct' ? 'directId' : externalType === 'thread' ? 'threadId' : 'roomId'
      : externalType === 'direct'
      ? 'userId'
      : 'chatId'
    const duplicate = channelLinks.find(link => (
      link.attributes.channel === channelKey &&
      link.attributes.external.type === externalType &&
      link.attributes.external[externalIdKey] === externalId
    ))
    if (duplicate != null) {
      throw badRequest('Channel association already exists', {
        path: relative(workspaceRoot, duplicate.path)
      }, 'channel_association_exists')
    }
    const directoryName = `${entityName}-${Date.now()}-${randomUUID().slice(0, 8)}`
      .replace(/[^\w-]+/gu, '-')
    const filePath = join(workspaceRoot, '.oo', 'channels', directoryName, 'channel.json')
    await mkdir(dirname(filePath), { recursive: true })
    await writeFile(
      filePath,
      `${
        JSON.stringify(
          {
            name: body.name.trim(),
            description: typeof body.description === 'string' ? body.description.trim() : '',
            channel: channelKey,
            entity: entityName,
            external: { type: externalType, [externalIdKey]: externalId }
          },
          null,
          2
        )
      }\n`,
      'utf8'
    )
    ctx.body = { ok: true, path: relative(workspaceRoot, filePath) }
  })

  router.delete('/entities/channel-links', async (ctx) => {
    const targetPath = typeof ctx.query.path === 'string' ? ctx.query.path : undefined
    if (targetPath == null) throw badRequest('Missing channel link path', undefined, 'missing_channel_link_path')
    const links = await loader.loadDefaultChannelLinks()
    const link = links.find(item => matchesDefinitionPath(item, targetPath, workspaceRoot))
    if (link == null) throw notFound('Channel link not found', undefined, 'channel_link_not_found')
    if (link.resolvedSource !== 'project') {
      throw forbidden('Plugin channel links cannot be removed here', undefined, 'channel_link_not_editable')
    }
    await rm(link.path)
    await rm(dirname(link.path), { recursive: false }).catch(() => undefined)
    ctx.body = { ok: true }
  })

  return router
}

import type { ChatMessageContent } from '@oneworks/core'
import type { ConfigSource } from '@oneworks/types'

export type ModelServiceConfigSessionMode = 'create' | 'update'
export type ModelServiceConfigSessionLanguage = 'en' | 'zh'

export interface ModelServiceConfigSessionRequest {
  mode: ModelServiceConfigSessionMode
  service?: Record<string, unknown>
  serviceKey?: string
  source: ConfigSource
}

export interface ModelServiceConfigSessionBuildOptions {
  globalConfigPath?: string
  language?: string
  projectConfigPath?: string
  userConfigPath?: string
}

export const getModelServiceConfigSessionActionKey = ({
  mode,
  serviceKey,
  source
}: {
  mode: ModelServiceConfigSessionMode
  serviceKey?: string
  source: ConfigSource
}) => `${source}:modelServices:${mode}:${serviceKey ?? 'new'}`

const resolvePromptLanguage = (language?: string): ModelServiceConfigSessionLanguage => (
  language == null || language.trim() === ''
    ? 'zh'
    : language.trim().toLowerCase().startsWith('zh')
    ? 'zh'
    : 'en'
)

const redactSensitiveValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(redactSensitiveValue)
  if (value == null || typeof value !== 'object') return value

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, item]) => [
      key,
      /key|token|secret|password/i.test(key) ? '<redacted>' : redactSensitiveValue(item)
    ])
  )
}

const resolveServiceTitle = (
  serviceKey?: string,
  service?: Record<string, unknown>,
  language: ModelServiceConfigSessionLanguage = 'zh'
) => {
  const title = typeof service?.title === 'string' ? service.title.trim() : ''
  if (title !== '') return title
  return serviceKey?.trim() || (language === 'en' ? 'new model service' : '新模型服务')
}

export const buildModelServiceConfigSessionTitle = (
  request: ModelServiceConfigSessionRequest,
  options: Pick<ModelServiceConfigSessionBuildOptions, 'language'> = {}
) => {
  const language = resolvePromptLanguage(options.language)
  if (request.mode === 'create') {
    return language === 'en' ? 'Add model service config' : '新增模型服务配置'
  }
  const serviceTitle = resolveServiceTitle(request.serviceKey, request.service, language)
  return language === 'en' ? `Update model service: ${serviceTitle}` : `修改模型服务：${serviceTitle}`
}

export const buildModelServiceConfigSessionPrompt = (
  request: ModelServiceConfigSessionRequest,
  options: ModelServiceConfigSessionBuildOptions = {}
) => {
  const language = resolvePromptLanguage(options.language)
  const target = request.mode === 'create'
    ? language === 'en' ? 'add a model service config' : '新增一个模型服务配置'
    : language === 'en'
    ? `update model service \`${
      request.serviceKey ?? resolveServiceTitle(request.serviceKey, request.service, language)
    }\``
    : `修改模型服务 \`${request.serviceKey ?? resolveServiceTitle(request.serviceKey, request.service, language)}\``
  const serviceSnapshot = request.service == null
    ? undefined
    : JSON.stringify(redactSensitiveValue(request.service), null, 2)
  const targetConfigPath = request.source === 'global'
    ? options.globalConfigPath
    : request.source === 'project'
    ? options.projectConfigPath
    : options.userConfigPath

  if (language === 'en') {
    return [
      `Please help me ${target}.`,
      '',
      'Requirements:',
      `- Current config source: \`${request.source}\`.${
        targetConfigPath != null ? ` Target config file: \`${targetConfigPath}\`.` : ''
      }`,
      '- Do not expose API keys, secrets, tokens, or other sensitive fields in the reply.',
      '- For official providers, prefer the provider registry defaults for homepage, apiBaseUrl, models, and management/status capabilities. Only write override fields when the user explicitly asks for them.',
      '- Use the built-in `oneworks-model-services` skill/documentation as the user-facing provider guide for provider ids, default API base URLs, portal links, model/balance/status capabilities, and setup workflow. Do not cite local repository paths or RFC files to the user.',
      '- When provider details are needed, read the built-in skill content instead of embedding or inventing a separate provider catalog in the conversation.',
      '- By default, account/API key configuration belongs in global config, not the project directory, unless the user explicitly asks for a project/user override.',
      '- Follow existing config source writeback semantics; do not infer the write target from merged config.',
      '- When UI verification is needed, use browser:control-in-app-browser to inspect the local config page and provider portal.',
      '',
      request.mode === 'update' && serviceSnapshot != null
        ? [
          'Current service config snapshot (sensitive fields redacted):',
          '```json',
          serviceSnapshot,
          '```'
        ].join('\n')
        : [
          'When adding a service, first confirm the provider, API key, whether to use the official default API base, whether model/balance/status capabilities are needed, and whether built-in model metadata is needed.',
          'When useful, guide the user to open the provider portal to log in, top up, create a secret, and then return to the config.'
        ].join('\n')
    ].join('\n')
  }

  return [
    `请帮我${target}。`,
    '',
    '要求：',
    `- 当前配置来源是 \`${request.source}\`。${
      targetConfigPath != null ? `目标配置文件：\`${targetConfigPath}\`。` : ''
    }`,
    '- 模型服务的 API key、secret、token 等敏感字段不要在回复里明文展示。',
    '- 如果是官方服务商，优先复用 provider registry 里的默认 homepage、apiBaseUrl、models、management/status 能力；只有用户明确要覆盖时才写覆盖字段。',
    '- 使用内置 `oneworks-model-services` 文档/skill 作为面向用户的平台接入指南，里面维护 provider id、默认 API 地址、后台入口、模型/余额/状态能力和配置流程；不要向用户引用本地仓库路径或 RFC 文件。',
    '- 需要平台细节时读取内置 skill 内容，不要在会话里额外塞一份平台目录，也不要临时编造。',
    '- 默认把账号/API key 类配置放到 global，不要写进项目目录；除非用户明确要求 project/user override。',
    '- 按现有 config source 写回语义操作，不要从 merged config 反推写回 source 文件。',
    '- 需要验证界面时，使用 browser:control-in-app-browser 检查本地配置页和服务商后台入口。',
    '',
    request.mode === 'update' && serviceSnapshot != null
      ? [
        '当前服务配置快照（敏感字段已脱敏）：',
        '```json',
        serviceSnapshot,
        '```'
      ].join('\n')
      : [
        '新增时请先确认：服务商、API key、是否使用官方默认 API base、是否需要查询模型/余额/状态能力、是否需要内置模型元数据。',
        '可以在需要时引导用户打开对应服务商主页完成登录、充值、创建 secret，再回到配置。'
      ].join('\n')
  ].join('\n')
}

export const buildModelServiceConfigSessionInitialContent = (
  request: ModelServiceConfigSessionRequest,
  options: ModelServiceConfigSessionBuildOptions = {}
): ChatMessageContent[] => [
  {
    type: 'text',
    text: buildModelServiceConfigSessionPrompt(request, options)
  }
]

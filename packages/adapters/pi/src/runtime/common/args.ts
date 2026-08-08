import type { AdapterQueryOptions } from '@oneworks/types'

import type { PiAdapterConfig } from '#~/config-schema.js'
import type { PiResolvedModel } from './model'

const DEFAULT_TOOLS = ['read', 'bash', 'edit', 'write']
const ALL_TOOLS = new Set([...DEFAULT_TOOLS, 'grep', 'find', 'ls'])
const CONTROLLED_OPTIONS = new Set([
  '--continue',
  '-c',
  '--export',
  '--fork',
  '--help',
  '-h',
  '--list-models',
  '--mode',
  '--models',
  '--name',
  '-n',
  '--print',
  '-p',
  '--provider',
  '--resume',
  '-r',
  '--model',
  '--api-key',
  '--system-prompt',
  '--append-system-prompt',
  '--thinking',
  '--session',
  '--session-id',
  '--session-dir',
  '--no-session',
  '--tools',
  '-t',
  '--exclude-tools',
  '-xt',
  '--no-tools',
  '-nt',
  '--no-builtin-tools',
  '-nbt',
  '--extension',
  '-e',
  '--no-extensions',
  '-ne',
  '--skill',
  '--no-skills',
  '-ns',
  '--prompt-template',
  '--no-prompt-templates',
  '-np',
  '--theme',
  '--no-themes',
  '--no-context-files',
  '-nc',
  '--approve',
  '-a',
  '--no-approve',
  '-na',
  '--offline',
  '--version',
  '-v'
])

const normalizeTool = (value: string, allowNativeToolNames: boolean) => {
  const nativeToken = value.trim().toLowerCase()
  const token = nativeToken.replace(/[^a-z0-9]/gu, '')
  if (token === 'shell') return 'bash'
  if (token === 'readfile') return 'read'
  if (token === 'writefile') return 'write'
  if (token === 'glob') return 'find'
  if (token === 'list') return 'ls'
  if (ALL_TOOLS.has(token)) return token
  return allowNativeToolNames && /^[a-z][a-z0-9_-]*$/u.test(nativeToken) && !nativeToken.startsWith('mcp__')
    ? nativeToken
    : undefined
}

export const resolvePiTools = (options: AdapterQueryOptions, allowNativeToolNames = false) => {
  const rawIncluded = options.tools?.include
  const normalize = (tool: string) => normalizeTool(tool, allowNativeToolNames)
  const included = (rawIncluded ?? []).map(normalize).filter((tool): tool is string => tool != null)
  const excluded = new Set(
    (options.tools?.exclude ?? []).map(normalize).filter((tool): tool is string => tool != null)
  )
  const initial = rawIncluded != null && rawIncluded.length > 0 ? included : DEFAULT_TOOLS
  const allowed = [...new Set(initial)].filter(tool => !excluded.has(tool))
  return options.permissionMode === 'plan'
    ? allowed.filter(tool => tool === 'read' || tool === 'grep' || tool === 'find' || tool === 'ls')
    : allowed
}

const resolveThinking = (effort: AdapterQueryOptions['effort']) => (
  effort === 'ultra' ? 'max' : effort
)

const assertSafeExtraOptions = (options: string[]) => {
  for (const option of options) {
    const flag = option.split('=', 1)[0]
    if (CONTROLLED_OPTIONS.has(flag)) {
      throw new Error(`Pi extra option "${flag}" is managed by One Works and cannot be overridden.`)
    }
  }
}

export const buildPiArgs = (params: {
  adapterConfig: PiAdapterConfig
  mode: 'direct' | 'stream'
  model: PiResolvedModel
  nativeExtensionPaths?: string[]
  options: AdapterQueryOptions
  permissionExtensionPath: string
  sessionDir: string
}) => {
  const extraOptions = params.options.extraOptions ?? []
  assertSafeExtraOptions(extraOptions)
  const nativeExtensionsEnabled = params.adapterConfig.enableNativeExtensions === true
  const tools = resolvePiTools(params.options, nativeExtensionsEnabled)
  const skills = (params.options.assetPlan?.overlays ?? [])
    .filter(overlay => overlay.kind === 'skill')
    .map(overlay => overlay.sourcePath)
  const thinking = resolveThinking(params.options.effort)
  return [
    ...(params.mode === 'stream' ? ['--mode', 'rpc'] : []),
    '--session-dir',
    params.sessionDir,
    '--session-id',
    params.options.sessionId,
    '--no-skills',
    '--no-prompt-templates',
    '--no-themes',
    '--no-context-files',
    ...(nativeExtensionsEnabled ? [] : ['--no-extensions']),
    '--extension',
    params.permissionExtensionPath,
    ...(nativeExtensionsEnabled
      ? (params.nativeExtensionPaths ?? []).flatMap(extensionPath => ['--extension', extensionPath])
      : []),
    ...(params.adapterConfig.projectTrust === 'always' ? ['--approve'] : ['--no-approve']),
    ...(tools.length > 0 ? ['--tools', tools.join(',')] : ['--no-tools']),
    ...skills.flatMap(skillPath => ['--skill', skillPath]),
    ...(params.model.cliProvider ? ['--provider', params.model.cliProvider] : []),
    ...(params.model.cliModel ? ['--model', params.model.cliModel] : []),
    ...(thinking ? ['--thinking', thinking] : []),
    ...(params.options.systemPrompt?.trim()
      ? [params.options.appendSystemPrompt ? '--append-system-prompt' : '--system-prompt', params.options.systemPrompt]
      : []),
    ...extraOptions
  ]
}

import { platform } from 'node:process'

import type { AdapterQueryOptions } from '@oneworks/types'

export const normalizeDshModel = (model: string | undefined) => {
  if (model == null || model === '' || model === 'deepseek-v4-flash') return 'deepseek-v4-flash'
  if (model === 'deepseek-v4-pro') return model
  throw new Error(`DSH does not support model "${model}"; select deepseek-v4-flash or deepseek-v4-pro.`)
}

const normalizeEffort = (effort: AdapterQueryOptions['effort']) => {
  if (effort == null) return undefined
  if (effort === 'low') return 'off'
  if (effort === 'medium') return 'high'
  return 'max'
}

export const resolveDshPermissionMode = (mode: AdapterQueryOptions['permissionMode']) => {
  if (mode === 'bypassPermissions') return 'danger-full-access'
  if (mode === 'plan') return 'read-only'
  return 'workspace-write'
}

export const buildDshComposition = (params: {
  cwd: string
  effort: AdapterQueryOptions['effort']
  model: string
  permissionMode: AdapterQueryOptions['permissionMode']
  persistenceRoot: string
  systemPrompt?: string
}) => {
  const permissionMode = resolveDshPermissionMode(params.permissionMode)
  const persona = params.systemPrompt?.trim() || [
    'You are a coding assistant powered by {{model}}.',
    'Your working directory is {{cwd}}.',
    'Verify your work with relevant tests and keep the final answer brief and factual.'
  ].join(' ')
  return [
    {
      id: 'llm-deepseek',
      name: '@deepseek-ai/dsh-llm-deepseek',
      config: {
        thinking: 'enabled',
        ...(normalizeEffort(params.effort) == null ? {} : { reasoningEffort: normalizeEffort(params.effort) }),
        models: [{ id: 'deepseek-v4-flash' }, { id: 'deepseek-v4-pro' }]
      }
    },
    { id: 'sandbox', name: '@deepseek-ai/dsh-sandbox-local' },
    {
      id: 'sandbox-policy',
      name: '@deepseek-ai/dsh-sandbox-policy',
      config: { mode: permissionMode, workspaceRoot: params.cwd }
    },
    { id: 'subprocess', name: '@deepseek-ai/dsh-subprocess-local' },
    {
      id: 'bash-sandbox',
      name: '@deepseek-ai/dsh-bash-sandbox',
      disabled: platform === 'win32',
      config: { timeoutMs: 60_000 }
    },
    {
      id: 'pwsh-sandbox',
      name: '@deepseek-ai/dsh-pwsh-sandbox',
      disabled: platform !== 'win32'
    },
    {
      id: 'tool-pwsh',
      name: '@deepseek-ai/dsh-tool-pwsh',
      disabled: platform !== 'win32'
    },
    {
      id: 'approval',
      name: '@deepseek-ai/dsh-user-approval',
      config: { policy: permissionMode === 'danger-full-access' ? 'never' : 'ask' }
    },
    {
      id: 'acp-agent',
      name: '@deepseek-ai/dsh-acp-demo',
      config: {
        provider: 'deepseek-official',
        model: params.model,
        persistenceRoot: params.persistenceRoot,
        persistenceCompression: 'none',
        workspaceContext: { maxBytes: 65_536 },
        persona
      }
    },
    { id: 'token-meter', name: '@deepseek-ai/dsh-token-meter' },
    {
      id: 'compaction-basic',
      name: '@deepseek-ai/dsh-compaction-basic',
      config: { thresholdRatio: 0.8, retainRatio: 0.08, maxTokens: 8192, compactionRetries: 1 }
    },
    { id: 'fs-sandbox', name: '@deepseek-ai/dsh-fs-sandbox', config: { cwd: params.cwd } },
    { id: 'fs-observation-policy', name: '@deepseek-ai/dsh-fs-observation-policy' },
    { id: 'tool-fs', name: '@deepseek-ai/dsh-tool-fs' },
    { id: 'tool-todo', name: '@deepseek-ai/dsh-tool-todo', config: { allowParallelInProgress: true } }
  ]
}

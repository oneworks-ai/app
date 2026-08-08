import type { AdapterCtx } from '@oneworks/types'

import { updateConfigFile } from './update'

const isRecord = (value: unknown): value is Record<string, unknown> => (
  value != null && typeof value === 'object' && !Array.isArray(value)
)

export interface UpdateGlobalAdapterAccountsOptions {
  adapter: string
  cwd: string
  env: AdapterCtx['env']
  update: (
    adapterConfig: Record<string, unknown>,
    accounts: Record<string, unknown>
  ) => Promise<Record<string, unknown>> | Record<string, unknown>
}

export const updateGlobalAdapterAccounts = async (
  options: UpdateGlobalAdapterAccountsOptions
) => {
  const adapter = options.adapter.trim()
  if (adapter === '') {
    throw new Error('Adapter account storage requires a non-empty adapter key.')
  }

  return await updateConfigFile({
    env: options.env,
    workspaceFolder: options.cwd,
    source: 'global',
    section: 'adapters',
    resolveValue: async (currentConfig) => {
      const adapters: Record<string, unknown> = isRecord(currentConfig.adapters)
        ? { ...currentConfig.adapters }
        : {}
      const adapterConfig = isRecord(adapters[adapter]) ? { ...adapters[adapter] } : {}
      const accounts = isRecord(adapterConfig.accounts) ? { ...adapterConfig.accounts } : {}
      adapters[adapter] = await options.update(adapterConfig, accounts)
      return adapters
    }
  })
}

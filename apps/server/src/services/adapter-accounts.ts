import type { AdapterCtx } from '@oneworks/types'
import { loadAdapter, resolveAdapterPackageName } from '@oneworks/types'
import { mergeProcessEnvWithProjectEnv } from '@oneworks/utils'
import { createLogger } from '@oneworks/utils/create-logger'

import { loadConfigState } from '#~/services/config/index.js'

const createTransientCache = (): AdapterCtx['cache'] => {
  const store = new Map<string, unknown>()

  return {
    set: async (key, value) => {
      store.set(String(key), value)
      return { cachePath: '' }
    },
    get: async (key) => store.get(String(key)) as any
  }
}

export const isMissingAdapterPackageError = (error: unknown, adapterKey: string) => {
  const code = (error as NodeJS.ErrnoException | undefined)?.code
  const message = error instanceof Error ? error.message : String(error)
  const packageName = resolveAdapterPackageName(adapterKey)
  return code === 'MODULE_NOT_FOUND' && message.includes(`Cannot find module '${packageName}'`)
}

export const createServerAdapterAccountContext = async (adapterKey: string) => {
  const { workspaceFolder, effectiveProjectConfig, projectConfig, userConfig } = await loadConfigState()
  const adapter = await loadAdapter(adapterKey)
  const env = mergeProcessEnvWithProjectEnv(undefined, { workspaceFolder })
  const adapterCtx = {
    ctxId: `server-adapter-accounts-${adapterKey}`,
    cwd: workspaceFolder,
    env,
    cache: createTransientCache(),
    logger: createLogger(workspaceFolder, `server/adapter-accounts/${adapterKey}`, 'server', '', 'info', env),
    configs: [effectiveProjectConfig ?? projectConfig, userConfig]
  } satisfies AdapterCtx

  return {
    workspaceFolder,
    adapter,
    adapterCtx
  }
}

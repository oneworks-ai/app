import type { RuntimeBrokerAcquireInput } from '@oneworks/runtime-broker'
import type { AdapterCtx, AdapterQueryOptions } from '@oneworks/types'

import { CODEX_APP_SERVER_RUNTIME_DRIVER_ID } from '#~/runtime-broker-contract.js'
import { listCodexAppServerWarmupAccountKeys } from './accounts'
import { resolveCodexAdapterConfig } from './config'
import { releaseCodexProxyMeta } from './proxy'
import { buildFeatureArgs, resolveSessionBase } from './session-common'
import { resolveCodexAppServerClientInfo } from './stream'

export interface CodexAppServerWarmupProfile {
  account?: string
  input: RuntimeBrokerAcquireInput
}

const createWarmupOptions = (account: string | undefined): AdapterQueryOptions => ({
  account,
  mode: 'stream',
  onEvent: () => undefined,
  runtime: 'server',
  sessionId: `runtime-broker-warmup-${account ?? 'default'}`,
  type: 'create'
})

export const buildCodexAppServerWarmupProfiles = async (
  ctx: AdapterCtx,
  limit = 3
): Promise<CodexAppServerWarmupProfile[]> => {
  const accountKeys = await listCodexAppServerWarmupAccountKeys(ctx, limit)
  const sharedCtx: AdapterCtx = {
    ...ctx,
    env: {
      ...ctx.env,
      __ONEWORKS_PROJECT_RUNTIME_BROKER_TOKEN__: 'manager-warmup',
      __ONEWORKS_PROJECT_RUNTIME_BROKER_URL__: 'http://runtime-broker.invalid'
    }
  }
  const { native } = resolveCodexAdapterConfig(sharedCtx)
  const profiles: CodexAppServerWarmupProfile[] = []

  for (const account of accountKeys) {
    const options = createWarmupOptions(account)
    try {
      const base = await resolveSessionBase(sharedCtx, options)
      try {
        if (base.appServerPoolKey == null) continue
        profiles.push({
          account,
          input: {
            driverId: CODEX_APP_SERVER_RUNTIME_DRIVER_ID,
            profileKey: base.appServerPoolKey,
            payload: {
              args: buildFeatureArgs(base.features),
              binaryPath: base.binaryPath,
              clientInfo: resolveCodexAppServerClientInfo(native.clientInfo),
              cwd: base.spawnEnv.HOME ?? base.cwd,
              env: base.spawnEnv,
              experimentalApi: native.experimentalApi === true,
              idleTimeoutMs: base.appServerIdleTimeoutMs
            }
          }
        })
      } finally {
        for (const routeId of base.proxyRouteTokens) releaseCodexProxyMeta(routeId)
      }
    } catch (error) {
      ctx.logger.warn('[codex app-server warmup] failed to build a configured account profile', { error })
    }
  }

  return profiles
}

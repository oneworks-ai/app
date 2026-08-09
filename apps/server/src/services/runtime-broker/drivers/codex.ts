import process from 'node:process'

import type {
  RuntimeBrokerAcquireInput,
  RuntimeBrokerDriver,
  RuntimeBrokerHttpConnection
} from '@oneworks/runtime-broker'
import type { AdapterCtx } from '@oneworks/types'
import { createLogger } from '@oneworks/utils/create-logger'

import { createServerAdapterAccountContext } from '#~/services/adapter-accounts.js'
import {
  getRuntimeBroker,
  getRuntimeBrokerCallbackConnection,
  registerRuntimeBrokerDriver
} from '#~/services/runtime-broker/index.js'
import { logger } from '#~/utils/logger.js'

const WARMUP_OWNER_ID = 'manager:codex-app-server-warmup'
const CODEX_DRIVER_MODULE_ID = '@oneworks/adapter-codex/runtime-broker-driver'

interface CodexDriverModule {
  buildCodexAppServerWarmupProfiles(
    ctx: AdapterCtx,
    limit?: number
  ): Promise<Array<{ input: RuntimeBrokerAcquireInput }>>
  createCodexAppServerRuntimeBrokerDriver(options: {
    getCallbackConnection(
      driverId: string,
      profileKey: string,
      leaseId: string
    ): RuntimeBrokerHttpConnection | undefined
    logger: ReturnType<typeof createLogger>
  }): RuntimeBrokerDriver
}

let driverModulePromise: Promise<CodexDriverModule> | undefined
let initializePromise: Promise<void> | undefined
let unregister: (() => void) | undefined
let warmupTimer: ReturnType<typeof setTimeout> | undefined

const loadDriverModule = () => {
  driverModulePromise ??= import(CODEX_DRIVER_MODULE_ID) as Promise<CodexDriverModule>
  return driverModulePromise
}

export const initializeCodexRuntimeBrokerDriver = async () => {
  if (unregister != null) return
  initializePromise ??= (async () => {
    const driverModule = await loadDriverModule()
    const adapterLogger = createLogger(
      process.cwd(),
      'server/runtime-broker',
      'codex-app-server',
      '',
      'info',
      process.env
    )
    unregister = registerRuntimeBrokerDriver(driverModule.createCodexAppServerRuntimeBrokerDriver({
      getCallbackConnection: getRuntimeBrokerCallbackConnection,
      logger: adapterLogger
    }))
  })().finally(() => {
    initializePromise = undefined
  })
  await initializePromise
}

export const scheduleCodexRuntimeBrokerWarmup = () => {
  if (warmupTimer != null) return
  warmupTimer = setTimeout(() => {
    warmupTimer = undefined
    void (async () => {
      const driverModule = await loadDriverModule()
      const { adapterCtx } = await createServerAdapterAccountContext('codex')
      const profiles = await driverModule.buildCodexAppServerWarmupProfiles(adapterCtx, 3)
      const broker = getRuntimeBroker()
      const results = await Promise.allSettled(profiles.map(async (profile) => {
        const acquired = await broker.acquire(WARMUP_OWNER_ID, profile.input)
        await broker.release(WARMUP_OWNER_ID, acquired.leaseId)
      }))
      const failures = results.filter(result => result.status === 'rejected')
      if (failures.length > 0) {
        logger.warn({ failures: failures.length }, '[runtime-broker] Codex app-server warmup partially failed')
      } else if (profiles.length > 0) {
        logger.info({ profiles: profiles.length }, '[runtime-broker] Codex app-server warmup complete')
      }
    })().catch(error => {
      logger.warn({ error }, '[runtime-broker] Codex app-server warmup failed')
    })
  }, 0)
  warmupTimer.unref?.()
}

export const disposeCodexRuntimeBrokerDriver = () => {
  if (warmupTimer != null) {
    clearTimeout(warmupTimer)
    warmupTimer = undefined
  }
  unregister = undefined
}

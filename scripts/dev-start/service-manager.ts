import { writeFileSync } from 'node:fs'
import process from 'node:process'

import { buildRuntimeEnv } from './env'
import { managerLogPath, repoRoot, serviceChildArg, statePath } from './paths'
import { spawnDetachedLogged, waitForChildSpawn } from './process'
import { processFingerprint } from './process-identity'
import { operationEnv, writeDevServiceState } from './state'
import type { DevServiceOperation, DevStartTarget, PortResolution, TargetConfig } from './types'

export const startServiceChild = async ({
  config,
  linkedDocsUrl,
  linkedHomepageUrl,
  operation,
  ports,
  target
}: {
  config: TargetConfig
  linkedDocsUrl?: string
  linkedHomepageUrl?: string
  operation?: DevServiceOperation
  ports: PortResolution
  target: DevStartTarget
}) => {
  writeFileSync(managerLogPath(target), '')

  const linkedEnv: NodeJS.ProcessEnv = {
    ...(linkedDocsUrl != null
      ? {
        PUBLIC_DOCS_URL: linkedDocsUrl,
        ONEWORKS_DEV_START_LINKED_DOCS_URL: linkedDocsUrl
      }
      : {}),
    ...(linkedHomepageUrl != null
      ? {
        ONEWORKS_DEV_START_LINKED_HOMEPAGE_URL: linkedHomepageUrl,
        VITE_ONEWORKS_DOCS_HOMEPAGE_URL: linkedHomepageUrl
      }
      : {})
  }

  const child = spawnDetachedLogged({
    args: ['--conditions=__oneworks__', 'scripts/run-tools.mjs', 'dev-start', target, serviceChildArg],
    command: process.execPath,
    cwd: repoRoot,
    env: {
      ...(await buildRuntimeEnv({
        base: config.base,
        clientMode: config.clientMode,
        clientPort: ports.clientPort,
        extra: {
          ...config.extraEnv,
          ...linkedEnv
        },
        serverPort: ports.serverPort
      })),
      ONEWORKS_DEV_START_STATE_FILE: statePath(target),
      ONEWORKS_DEV_START_TARGET: target,
      ...operationEnv(operation),
      ...linkedEnv
    },
    logPath: managerLogPath(target)
  })
  await waitForChildSpawn(child, `${target} service manager`)
  if (child.pid == null) throw new Error(`${target} service manager did not report a pid.`)
  const serviceFingerprint = processFingerprint(child.pid)
  try {
    if (serviceFingerprint == null) throw new Error(`Could not fingerprint ${target} service manager.`)
    writeDevServiceState(target, {
      clientPort: ports.clientPort,
      components: [],
      generation: operation?.id,
      managerLog: managerLogPath(target),
      operation,
      phase: 'starting',
      readiness: config.readiness,
      root: repoRoot,
      serverPort: ports.serverPort,
      serviceFingerprint,
      servicePid: child.pid,
      startedAt: new Date().toISOString(),
      target
    })
  } catch (error) {
    child.kill('SIGTERM')
    throw error
  }
}

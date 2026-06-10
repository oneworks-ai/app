import { rmSync, writeFileSync } from 'node:fs'
import process from 'node:process'

import { buildRuntimeEnv } from './env'
import { managerLogPath, repoRoot, serviceChildArg, statePath } from './paths'
import { spawnDetachedLogged } from './process'
import type { DevStartTarget, PortResolution, TargetConfig } from './types'

export const startServiceChild = async ({
  config,
  linkedDocsUrl,
  linkedHomepageUrl,
  ports,
  target
}: {
  config: TargetConfig
  linkedDocsUrl?: string
  linkedHomepageUrl?: string
  ports: PortResolution
  target: DevStartTarget
}) => {
  rmSync(statePath(target), { force: true })
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

  spawnDetachedLogged({
    args: ['scripts/run-tools.mjs', 'dev-start', target, serviceChildArg],
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
      ...linkedEnv
    },
    logPath: managerLogPath(target)
  })
}

import { realpath, stat } from 'node:fs/promises'
import process from 'node:process'

import { badRequest } from '#~/utils/http.js'

export const resolveAssetCreateAuthority = async (
  env: NodeJS.ProcessEnv = process.env
) => {
  if (env.__ONEWORKS_PROJECT_SERVER_ROLE__ === 'manager') {
    throw badRequest('Data assets require a workspace server', undefined, 'asset_workspace_required')
  }
  const configuredRoot = env.__ONEWORKS_PROJECT_WORKSPACE_FOLDER__?.trim()
  if (configuredRoot == null || configuredRoot === '') {
    throw badRequest('Missing workspace authority', undefined, 'asset_workspace_required')
  }
  const canonicalRoot = await realpath(configuredRoot).catch(() => {
    throw badRequest('Invalid workspace authority', undefined, 'asset_workspace_invalid')
  })
  const rootStat = await stat(canonicalRoot, { bigint: true })
  if (!rootStat.isDirectory()) {
    throw badRequest('Invalid workspace authority', undefined, 'asset_workspace_invalid')
  }
  return {
    identity: { dev: rootStat.dev, ino: rootStat.ino },
    workspaceRoot: canonicalRoot
  }
}

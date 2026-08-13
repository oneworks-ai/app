import { realpath, stat } from 'node:fs/promises'
import process from 'node:process'

import { badRequest } from '#~/utils/http.js'

export interface AssetWorkspaceAuthority {
  identity: { dev: bigint; ino: bigint }
  workspaceRoot: string
}

export const resolveAssetCreateAuthority = async (
  env: NodeJS.ProcessEnv = process.env
): Promise<AssetWorkspaceAuthority> => {
  if (env.__ONEWORKS_PROJECT_SERVER_ROLE__ === 'manager') {
    throw badRequest('Data assets require a workspace server', undefined, 'asset_workspace_required')
  }
  const configuredRoot = env.__ONEWORKS_PROJECT_WORKSPACE_FOLDER__
  if (configuredRoot == null || configuredRoot.trim() === '') {
    throw badRequest('Missing workspace authority', undefined, 'asset_workspace_required')
  }
  const workspaceRoot = await realpath(configuredRoot).catch(() => {
    throw badRequest('Invalid workspace authority', undefined, 'asset_workspace_invalid')
  })
  const workspace = await stat(workspaceRoot, { bigint: true })
  if (!workspace.isDirectory()) {
    throw badRequest('Invalid workspace authority', undefined, 'asset_workspace_invalid')
  }
  return { identity: { dev: workspace.dev, ino: workspace.ino }, workspaceRoot }
}

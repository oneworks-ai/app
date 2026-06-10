import process from 'node:process'

import { resolveProjectWorkspaceFolder } from '@oneworks/utils'

export const resolveCliWorkspaceCwd = (
  cwd: string = process.cwd(),
  env: NodeJS.ProcessEnv = process.env
) => {
  const workspaceCwd = resolveProjectWorkspaceFolder(cwd, env)
  env.__ONEWORKS_PROJECT_WORKSPACE_FOLDER__ = workspaceCwd
  return workspaceCwd
}

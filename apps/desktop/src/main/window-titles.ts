import { isStandaloneDeviceRoutePath } from '@oneworks/types'

import { getWorkspaceDisplayName } from '../workspace-state.cjs'

export const ensureTrailingSlash = (value: string) => (
  value.endsWith('/') ? value : `${value}/`
)

export const buildWorkspaceWindowTitle = (workspaceFolder: string) =>
  `${getWorkspaceDisplayName(workspaceFolder)} - One Works`
export const buildLauncherWindowTitle = () => 'One Works'
export const buildStandaloneTabWindowTitle = (routePath: string) => (
  isStandaloneDeviceRoutePath(routePath) ? 'Debug Phone - One Works' : 'One Works'
)
export const buildWorkspaceSelectorWindowTitle = () => 'Choose Project - One Works'

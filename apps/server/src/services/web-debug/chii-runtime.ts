import { ONE_WORKS_DEVTOOLS_ASSET_VERSION } from './chii-devtools-assets.js'

const WEB_DEBUG_CHII_ROUTE_ROOT = '/__oneworks_chii__'
const WEB_DEBUG_CHII_WORKSPACE_ROUTE_SEGMENT = 'workspaces'

export const WEB_DEBUG_CHII_BASE_PATH = `${WEB_DEBUG_CHII_ROUTE_ROOT}/`
export const WEB_DEBUG_CHII_ROUTE_PREFIX = `${WEB_DEBUG_CHII_ROUTE_ROOT}/`
export const WEB_DEBUG_CHII_WORKSPACE_ROUTE_PREFIX =
  `${WEB_DEBUG_CHII_ROUTE_PREFIX}${WEB_DEBUG_CHII_WORKSPACE_ROUTE_SEGMENT}/`

export interface WebDebugChiiRuntime {
  basePath: string
  consoleUrl: string
  devtoolsAssetVersion: string
  targetUrl: string
  targetsUrl: string
}

const normalizeBaseOrigin = (origin: string) => {
  const trimmed = origin.trim()
  return trimmed.endsWith('/') ? trimmed : `${trimmed}/`
}

export const normalizeWebDebugWorkspaceId = (value: unknown) => {
  if (typeof value !== 'string') return undefined
  const trimmedValue = value.trim()
  return /^w_[\w-]{8,64}$/u.test(trimmedValue) ? trimmedValue : undefined
}

export const createWebDebugWorkspaceChiiBasePath = (workspaceId: string) => {
  const normalizedWorkspaceId = normalizeWebDebugWorkspaceId(workspaceId)
  if (normalizedWorkspaceId == null) {
    throw new Error('Invalid workspace id')
  }

  return `${WEB_DEBUG_CHII_WORKSPACE_ROUTE_PREFIX}${encodeURIComponent(normalizedWorkspaceId)}/`
}

export const getWebDebugChiiRuntime = (
  origin: string,
  input: {
    basePath?: string
  } = {}
): WebDebugChiiRuntime => {
  const baseOrigin = normalizeBaseOrigin(origin)
  const basePath = input.basePath ?? WEB_DEBUG_CHII_BASE_PATH
  return {
    basePath,
    consoleUrl: new URL(basePath, baseOrigin).toString(),
    devtoolsAssetVersion: ONE_WORKS_DEVTOOLS_ASSET_VERSION,
    targetUrl: new URL(`${basePath}target.js`, baseOrigin).toString(),
    targetsUrl: new URL(`${basePath}targets`, baseOrigin).toString()
  }
}

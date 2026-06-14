import { ONE_WORKS_DEVTOOLS_ASSET_VERSION } from './chii-devtools-assets.js'

const WEB_DEBUG_CHII_ROUTE_ROOT = '/__oneworks_chii__'

export const WEB_DEBUG_CHII_BASE_PATH = `${WEB_DEBUG_CHII_ROUTE_ROOT}/`
export const WEB_DEBUG_CHII_ROUTE_PREFIX = `${WEB_DEBUG_CHII_ROUTE_ROOT}/`

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

export const getWebDebugChiiRuntime = (origin: string): WebDebugChiiRuntime => {
  const baseOrigin = normalizeBaseOrigin(origin)
  return {
    basePath: WEB_DEBUG_CHII_BASE_PATH,
    consoleUrl: new URL(WEB_DEBUG_CHII_BASE_PATH, baseOrigin).toString(),
    devtoolsAssetVersion: ONE_WORKS_DEVTOOLS_ASSET_VERSION,
    targetUrl: new URL(`${WEB_DEBUG_CHII_BASE_PATH}target.js`, baseOrigin).toString(),
    targetsUrl: new URL(`${WEB_DEBUG_CHII_BASE_PATH}targets`, baseOrigin).toString()
  }
}

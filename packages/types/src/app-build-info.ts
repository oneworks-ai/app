/**
 * Public, secret-free build identity shared by browser and server surfaces.
 *
 * Missing commit or time metadata is represented by `null`; callers must not
 * substitute the current time because that would make the fingerprint change
 * between requests. The only runtime ingress is raw JSON text decoded by the
 * shared parser; callers never pass arbitrary objects to the contract.
 */
export {
  APP_BUILD_VERSION_FALLBACK,
  parseAppBuildInfoJson
} from './app-build-info-runtime.js'

export type {
  AppBuildInfo,
  AppBuildTimeSource
} from './app-build-info-runtime.js'

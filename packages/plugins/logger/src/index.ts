export { default as logger } from './hooks'

declare module '@oneworks/types' {
  interface HookPluginMap {
    logger: {}
  }
}

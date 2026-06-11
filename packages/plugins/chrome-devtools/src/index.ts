export { default as chromeDevtools } from './hooks'

declare module '@oneworks/types' {
  interface HookPluginMap {
    'chrome-devtools': {}
  }
}

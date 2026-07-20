import { chinaRedTheme } from './theme'

export { normalizeChinaRedThemeSettings } from './settings'
export { chinaRedTheme }

export function activatePlugin(ctx: {
  themes: { register: (theme: typeof chinaRedTheme) => { dispose: () => void } }
}) {
  return ctx.themes.register(chinaRedTheme)
}

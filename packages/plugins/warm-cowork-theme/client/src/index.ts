import { warmCoworkTheme } from './theme'

export { normalizeWarmCoworkThemeSettings } from './settings'
export type { WarmCoworkThemeSettings } from './settings'
export { warmCoworkTheme }

export function activatePlugin(ctx: {
  themes: { register: (theme: typeof warmCoworkTheme) => { dispose: () => void } }
}) {
  return ctx.themes.register(warmCoworkTheme)
}

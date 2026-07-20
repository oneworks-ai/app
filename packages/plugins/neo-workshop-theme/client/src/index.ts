import { neoWorkshopTheme } from './theme'

export { normalizeNeoWorkshopThemeSettings } from './settings'
export type { NeoWorkshopThemeSettings } from './settings'
export { neoWorkshopTheme }

export function activatePlugin(ctx: {
  themes: { register: (theme: typeof neoWorkshopTheme) => { dispose: () => void } }
}) {
  return ctx.themes.register(neoWorkshopTheme)
}

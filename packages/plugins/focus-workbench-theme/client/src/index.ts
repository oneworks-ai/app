import { focusWorkbenchTheme } from './theme'

export { normalizeFocusWorkbenchThemeSettings } from './settings'
export type { FocusWorkbenchThemeSettings } from './settings'
export { focusWorkbenchTheme }

export function activatePlugin(ctx: {
  themes: { register: (theme: typeof focusWorkbenchTheme) => { dispose: () => void } }
}) {
  return ctx.themes.register(focusWorkbenchTheme)
}

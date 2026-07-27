const readPluginVersion = () => {
  try {
    return new URL(import.meta.url).searchParams.get('pluginVersion') ?? String(Date.now())
  } catch {
    return String(Date.now())
  }
}

const importVersionedPeer = (path, version) =>
  import(/* @vite-ignore */ `${path}?pluginVersion=${encodeURIComponent(version)}`)

const loadCuaDriverModules = () => {
  if ((import.meta as any).env.DEV) return Promise.all([import('./styles'), import('./view')])
  const version = readPluginVersion()
  return Promise.all([
    importVersionedPeer('./styles.js', version),
    importVersionedPeer('./view.js', version)
  ])
}

const activeReloads = new Set<() => Promise<void>>()
const activeStyles = new Set<HTMLStyleElement>()
const reloadActivePlugins = () => {
  activeReloads.forEach(reload => void reload())
}

if ((import.meta as any).hot) {
  ;(import.meta as any).hot.accept('./styles.ts', (styles) => {
    if (styles == null) return
    activeStyles.forEach(style => {
      style.textContent = styles.cuaDriverCss
    })
  })
  ;(import.meta as any).hot.accept(reloadActivePlugins)
}

export async function activatePlugin(ctx) {
  const [{ cuaDriverCss }, { CuaDriverView }] = await loadCuaDriverModules()
  const style = document.createElement('style')
  style.textContent = cuaDriverCss
  document.head.appendChild(style)
  activeStyles.add(style)
  const reload = () => ctx.hot.reload()
  activeReloads.add(reload)

  const disposable = ctx.views.register('control', {
    renderNode: view => ctx.react.createElement(CuaDriverView, { ctx, react: ctx.react, view })
  })
  return {
    dispose() {
      disposable.dispose()
      activeReloads.delete(reload)
      activeStyles.delete(style)
      style.remove()
    }
  }
}

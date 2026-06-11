const externalUrlPattern = /^[a-z][a-z\d+\-.]*:|^\/\//i

export const resolvePluginReadmeAssetPath = (readmePath: string, href: string) => {
  const trimmed = href.trim()
  if (trimmed === '' || trimmed.startsWith('#') || externalUrlPattern.test(trimmed)) {
    return undefined
  }

  const readmeDirectory = readmePath
    .replace(/\\/g, '/')
    .split('/')
    .slice(0, -1)
    .filter(Boolean)
    .join('/')
  const basePath = readmeDirectory === '' ? '/' : `/${readmeDirectory}/`
  try {
    const resolvedUrl = new URL(trimmed, `https://plugin.local${basePath}`)
    if (resolvedUrl.origin !== 'https://plugin.local') return undefined
    const assetPath = decodeURIComponent(resolvedUrl.pathname).replace(/^\/+/, '')
    return assetPath === '' ? undefined : assetPath
  } catch {
    return undefined
  }
}

const decodeAssetReference = (value: string) => {
  let decoded = value
  for (let pass = 0; pass < 4; pass += 1) {
    try {
      const next = decodeURIComponent(decoded)
      if (next === decoded) return decoded
      decoded = next
    } catch {
      return undefined
    }
  }
  try {
    return decodeURIComponent(decoded) === decoded ? decoded : undefined
  } catch {
    return undefined
  }
}

const getAssetPathname = (value: string) => {
  const schemeRelative = value.startsWith('//')
  const schemeMatch = /^[a-z][a-z0-9+.-]*:\/\//iu.exec(value)
  if (schemeRelative || schemeMatch != null) {
    const authorityStart = schemeRelative ? 2 : schemeMatch?.[0].length ?? 0
    let pathStart = authorityStart
    while (pathStart < value.length && !/[/?#]/u.test(value[pathStart] ?? '')) pathStart += 1
    if (value[pathStart] !== '/') return ''
    const pathEnd = value.slice(pathStart).search(/[?#]/u)
    return pathEnd < 0 ? value.slice(pathStart) : value.slice(pathStart, pathStart + pathEnd)
  }
  const pathEnd = value.search(/[?#]/u)
  return pathEnd < 0 ? value : value.slice(0, pathEnd)
}

export const getPluginAssetQueryFragment = (value: string) => {
  const queryIndex = value.indexOf('?')
  const fragmentIndex = value.indexOf('#')
  if (queryIndex < 0) return fragmentIndex < 0 ? undefined : value.slice(fragmentIndex)
  if (fragmentIndex < 0) return value.slice(queryIndex)
  return value.slice(Math.min(queryIndex, fragmentIndex))
}

export const decodeSafePluginAssetReference = (value: string) => {
  const decoded = decodeAssetReference(value)
  if (
    decoded == null ||
    decoded.includes('\0') ||
    decoded.includes('\\') ||
    getAssetPathname(decoded).split('/').includes('..')
  ) return undefined
  return decoded
}

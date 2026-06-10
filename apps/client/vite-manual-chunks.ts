const getNodeModulePackageName = (id: string) => {
  const normalizedId = id.replace(/\\/g, '/')
  const marker = '/node_modules/'
  const index = normalizedId.lastIndexOf(marker)
  if (index < 0) return undefined

  const segments = normalizedId.slice(index + marker.length).split('/')
  const first = segments[0]
  if (first == null || first === '') return undefined
  if (first.startsWith('@')) {
    const second = segments[1]
    return second == null || second === '' ? undefined : `${first}/${second}`
  }

  return first
}

export const resolveManualChunk = (id: string) => {
  const packageName = getNodeModulePackageName(id)
  if (packageName == null) return undefined

  if (
    packageName === 'react' ||
    packageName === 'react-dom' ||
    packageName === 'react-router-dom' ||
    packageName === 'scheduler' ||
    packageName === 'use-sync-external-store'
  ) {
    return 'vendor-react'
  }

  if (
    packageName === 'jotai' ||
    packageName === 'swr' ||
    packageName === 'i18next' ||
    packageName === 'react-i18next'
  ) {
    return 'vendor-state'
  }

  return undefined
}

let packageJson: Record<string, unknown> | undefined

const getPackageJson = () => {
  if (!packageJson) {
    try {
      // eslint-disable-next-line ts/no-require-imports
      packageJson = require('@oneworks/server/package.json') as Record<string, unknown>
    } catch {
      packageJson = {}
    }
  }

  return packageJson
}

export const getServerPackageConfig = (key: string, defaultValue = '') => {
  const value = getPackageJson()[key]
  return typeof value === 'string' ? value : defaultValue
}

export const getServerVersion = () => getServerPackageConfig('version', '0.0.0')

export const getServerDescription = () => getServerPackageConfig('description', 'One Works server')

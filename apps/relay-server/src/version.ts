interface RelayServerPackageJson {
  version?: unknown
}

const readPackageVersion = () => {
  // eslint-disable-next-line ts/no-require-imports
  const relayServerPackage = require('@oneworks/relay-server/package.json') as RelayServerPackageJson
  return typeof relayServerPackage.version === 'string' ? relayServerPackage.version : '0.0.0'
}

export const VERSION = readPackageVersion()

const fs = require('node:fs')
const path = require('node:path')

const startedAt = Date.now()
process.env.__ONEWORKS_DESKTOP_SERVER_CHILD_STARTED_AT__ = String(startedAt)

const logServerChildStartup = (message) => {
  process.stdout.write(`[oneworks-server-child] ${message} elapsed=${Date.now() - startedAt}ms\n`)
}

logServerChildStartup('process entered')

const resolveEsbuildBinaryPackageName = () => {
  if (process.platform === 'win32') {
    return `win32-${process.arch}`
  }

  return `${process.platform}-${process.arch}`
}

const resolveUnpackedAsarPath = (candidatePath) => {
  const marker = `${path.sep}app.asar${path.sep}`
  if (!candidatePath.includes(marker)) return undefined

  const unpackedPath = candidatePath.replace(marker, `${path.sep}app.asar.unpacked${path.sep}`)
  return fs.existsSync(unpackedPath) ? unpackedPath : undefined
}

const configurePackagedEsbuildBinary = () => {
  if (process.env.ESBUILD_BINARY_PATH) return

  let registerPackageDir
  try {
    registerPackageDir = path.dirname(require.resolve('@oneworks/register/package.json'))
  } catch {
    return
  }

  const binaryName = process.platform === 'win32' ? 'esbuild.exe' : 'esbuild'
  const asarBinaryPath = path.join(
    registerPackageDir,
    'node_modules',
    '@esbuild',
    resolveEsbuildBinaryPackageName(),
    'bin',
    binaryName
  )
  const unpackedBinaryPath = resolveUnpackedAsarPath(asarBinaryPath)
  if (unpackedBinaryPath != null) {
    process.env.ESBUILD_BINARY_PATH = unpackedBinaryPath
  }
}

configurePackagedEsbuildBinary()
logServerChildStartup('packaged esbuild configured')

try {
  logServerChildStartup('builtin package cache prepare begin')
  const {
    ensureBuiltinAdapterPackageCache,
    ensureBuiltinPluginPackageCache
  } = require('./builtin-adapter-cache.cjs')
  ensureBuiltinAdapterPackageCache()
  ensureBuiltinPluginPackageCache()
  logServerChildStartup('builtin package cache prepare complete')
} catch (error) {
  console.error('[desktop] failed to prepare built-in package cache:', error)
}

const resolveConfiguredServerPackageDir = () => {
  const configuredPackageDir = process.env.__ONEWORKS_DESKTOP_SERVER_PACKAGE_DIR__
  if (typeof configuredPackageDir !== 'string' || configuredPackageDir.trim() === '') {
    return undefined
  }

  try {
    const packageJsonPath = path.join(configuredPackageDir, 'package.json')
    const packageInfo = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'))
    return packageInfo?.name === '@oneworks/server' ? configuredPackageDir : undefined
  } catch {
    return undefined
  }
}

logServerChildStartup('resolving server package')
const serverPackageDir = resolveConfiguredServerPackageDir() ??
  path.dirname(require.resolve('@oneworks/server/package.json'))
logServerChildStartup(`server package resolved path=${serverPackageDir}`)

logServerChildStartup('handoff to cli package entrypoint')
require('@oneworks/cli-helper/entry').runCliPackageEntrypoint({
  packageDir: serverPackageDir,
  sourceEntry: './src/index.ts',
  distEntry: './dist/__INTERNAL__home/index.js'
})

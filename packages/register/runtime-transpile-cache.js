const crypto = require('node:crypto')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const process = require('node:process')

const { getTsconfig } = require('get-tsconfig')

const EXPLICIT_CACHE_DIR_ENV = 'ONEWORKS_RUNTIME_TRANSPILE_CACHE_DIR'
const RUNTIME_CACHE_VERSION_ENV_KEYS = [
  '__ONEWORKS_RUNTIME_PACKAGE_CACHE_VERSION__',
  'ONEWORKS_RUNTIME_PACKAGE_CACHE_VERSION',
  '__ONEWORKS_DESKTOP_DEV_RUNTIME_VERSION__',
  'ONEWORKS_DESKTOP_DEV_RUNTIME_VERSION'
]

const normalizePathSegment = value => value.replace(/[^\w.+-]/gu, '_')

const resolveRealHomeDir = env => (
  env.__ONEWORKS_PROJECT_REAL_HOME__?.trim() ||
  env.HOME?.trim() ||
  env.USERPROFILE?.trim() ||
  os.homedir()
)

const resolveRuntimeCacheVersion = env =>
  RUNTIME_CACHE_VERSION_ENV_KEYS
    .map(key => env[key]?.trim())
    .find(Boolean)

const resolveRuntimeTranspileCacheDir = (env = process.env) => {
  const explicit = env[EXPLICIT_CACHE_DIR_ENV]?.trim()
  if (explicit) return path.resolve(explicit)

  const runtimeVersion = resolveRuntimeCacheVersion(env)
  if (!runtimeVersion) return undefined

  const packageCacheRoot = env.__ONEWORKS_PROJECT_PACKAGE_CACHE_DIR__?.trim() ||
    path.join(resolveRealHomeDir(env), '.oneworks', 'bootstrap')
  return path.join(
    packageCacheRoot,
    'transpile-cache',
    normalizePathSegment(runtimeVersion),
    `node-${process.versions.node}`
  )
}

const hashValue = value => crypto.createHash('sha256').update(value).digest('hex')

const findNearestCompilerConfigPath = (filename, configName) => {
  let currentDir = path.dirname(filename)
  while (true) {
    const configPath = path.join(currentDir, configName)
    if (fs.existsSync(configPath)) return configPath
    const parentDir = path.dirname(currentDir)
    if (parentDir === currentDir) return undefined
    currentDir = parentDir
  }
}

const readCompilerConfigFingerprintInput = (filename, configName) => {
  try {
    const resolved = getTsconfig(filename, configName)
    if (resolved != null) {
      return `${path.resolve(resolved.path)}\0${JSON.stringify(resolved.config)}`
    }
  } catch {
    // Packaged source trees can intentionally omit a repository-level extends target.
    // Hash the nearest raw config in that case; cache safety must never become a startup gate.
  }

  const configPath = findNearestCompilerConfigPath(filename, configName)
  if (configPath == null) return `${configName}:none`
  try {
    return `${path.resolve(configPath)}\0${fs.readFileSync(configPath, 'utf8')}`
  } catch {
    return `${path.resolve(configPath)}:unreadable`
  }
}

const resolveCompilerConfigFingerprint = filename => {
  return hashValue(
    ['tsconfig.json', 'jsconfig.json']
      .map(configName => readCompilerConfigFingerprintInput(filename, configName))
      .sort()
      .join('\0')
  )
}

const buildCacheKey = ({ code, compilerConfigFingerprint, filename, options, transformVersion }) =>
  hashValue([
    'oneworks-runtime-transpile-cache-v2',
    process.versions.node,
    transformVersion,
    filename,
    compilerConfigFingerprint ?? 'none',
    JSON.stringify(options),
    code
  ].join('\0'))

const readCachedCode = cachePath => {
  try {
    const payload = JSON.parse(fs.readFileSync(cachePath, 'utf8'))
    if (
      payload?.version !== 1 ||
      typeof payload.code !== 'string' ||
      typeof payload.codeHash !== 'string' ||
      hashValue(payload.code) !== payload.codeHash
    ) {
      return undefined
    }
    return payload.code
  } catch {
    return undefined
  }
}

const writeCachedCode = (cachePath, code) => {
  const directory = path.dirname(cachePath)
  const temporaryPath = `${cachePath}.${process.pid}.${crypto.randomUUID()}.tmp`
  try {
    fs.mkdirSync(directory, { recursive: true })
    fs.writeFileSync(
      temporaryPath,
      JSON.stringify({ code, codeHash: hashValue(code), version: 1 }),
      'utf8'
    )
    fs.renameSync(temporaryPath, cachePath)
  } catch {
    try {
      fs.rmSync(temporaryPath, { force: true })
    } catch {}
  }
}

const loadOrTransformSync = ({
  cacheDir = resolveRuntimeTranspileCacheDir(),
  code,
  compilerConfigFingerprint,
  filename,
  options,
  transform,
  transformVersion
}) => {
  if (!cacheDir) return transform()

  const key = buildCacheKey({ code, compilerConfigFingerprint, filename, options, transformVersion })
  const cachePath = path.join(cacheDir, key.slice(0, 2), `${key}.json`)
  const cached = readCachedCode(cachePath)
  if (cached != null) return cached

  const transformed = transform()
  writeCachedCode(cachePath, transformed)
  return transformed
}

module.exports = {
  loadOrTransformSync,
  resolveCompilerConfigFingerprint,
  resolveRuntimeTranspileCacheDir
}

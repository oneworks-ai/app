const { Buffer } = require('node:buffer')
const { spawn } = require('node:child_process')
const fs = require('node:fs')
const http = require('node:http')
const net = require('node:net')
const os = require('node:os')
const path = require('node:path')

const { resolveProjectHomePath } = require('@oneworks/register/dotenv')
const { BUILTIN_PLUGIN_PACKAGES } = require('../src/builtin-adapter-cache.cjs')
const { resolveDesktopAppMetadata } = require('./desktop-app-metadata.cjs')
const { normalizeArch } = require('./desktop-archs.cjs')

const desktopRoot = path.resolve(__dirname, '..')
const workspaceRoot = path.resolve(desktopRoot, '../..')
const outputDir = path.join(desktopRoot, 'out')
const appMetadata = resolveDesktopAppMetadata()
const appName = appMetadata.productName
const host = '127.0.0.1'
const resolvePositiveTimeoutMs = (env, name, fallbackMs) => {
  const rawValue = env[name]?.trim() || String(fallbackMs)
  if (!/^[1-9]\d*$/u.test(rawValue)) {
    throw new Error(`${name} must be a positive integer, received: ${rawValue}`)
  }
  const value = Number(rawValue)
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer, received: ${rawValue}`)
  }
  return value
}
const serverReadyTimeoutMs = resolvePositiveTimeoutMs(
  process.env,
  'ONEWORKS_DESKTOP_SMOKE_TIMEOUT_MS',
  120000
)
const serverRequestTimeoutMs = resolvePositiveTimeoutMs(
  process.env,
  'ONEWORKS_DESKTOP_SMOKE_REQUEST_TIMEOUT_MS',
  30000
)
const serverCompileTimeoutMs = resolvePositiveTimeoutMs(
  process.env,
  'ONEWORKS_DESKTOP_SMOKE_COMPILE_TIMEOUT_MS',
  120000
)

const createWorkspaceRuntimeEnv = (
  runtimePackageCacheVersion,
  runtimePackageBuildFingerprint,
  workspaceFolder,
  realHomeDir,
  packageCacheRootDir
) => {
  const env = { ...process.env }
  delete env.__ONEWORKS_PROJECT_PRIMARY_WORKSPACE_FOLDER__
  env.__ONEWORKS_PROJECT_WORKSPACE_FOLDER__ = workspaceFolder
  if (realHomeDir != null) {
    delete env.__ONEWORKS_DESKTOP_BUILTIN_ADAPTER_PACKAGES__
    delete env.__ONEWORKS_DESKTOP_SERVER_PACKAGE_DIR__
    delete env.__ONEWORKS_PROJECT_CLI_PACKAGE_DIR__
    delete env.__ONEWORKS_PROJECT_PACKAGE_DIR__
    delete env.__ONEWORKS_RUNTIME_PROTOCOL_CONSUMER_CLI_PATH__
    delete env.__ONEWORKS_RUNTIME_PROTOCOL_FALLBACK_BOOTSTRAP_PATH__
    env.__ONEWORKS_PROJECT_REAL_HOME__ = realHomeDir
  }
  if (packageCacheRootDir != null) {
    env.__ONEWORKS_PROJECT_PACKAGE_CACHE_DIR__ = packageCacheRootDir
  }
  if (runtimePackageCacheVersion != null) {
    env.__ONEWORKS_DESKTOP_DEV_RUNTIME_VERSION__ = runtimePackageCacheVersion
    env.__ONEWORKS_RUNTIME_PACKAGE_CACHE_VERSION__ = runtimePackageCacheVersion
  }
  if (runtimePackageBuildFingerprint != null) {
    env.__ONEWORKS_DESKTOP_RUNTIME_PACKAGE_BUILD_FINGERPRINT__ = runtimePackageBuildFingerprint
    env.__ONEWORKS_DESKTOP_TRUST_DEV_RUNTIME_CACHE_MANIFEST__ = '1'
  }
  return env
}

const readRuntimePackageCacheMetadata = (resourcesDir) => {
  try {
    const buildSource = JSON.parse(
      fs.readFileSync(path.join(resourcesDir, 'desktop-build-source.json'), 'utf8')
    )
    return {
      runtimePackageBuildFingerprint: typeof buildSource.runtimePackageBuildFingerprint === 'string'
        ? buildSource.runtimePackageBuildFingerprint
        : undefined,
      runtimePackageCacheVersion: typeof buildSource.runtimePackageCacheVersion === 'string' &&
          buildSource.runtimePackageCacheVersion.startsWith('dev-')
        ? buildSource.runtimePackageCacheVersion
        : undefined
    }
  } catch {
    return {}
  }
}

const findPackageDir = () => {
  const packageDirs = fs.readdirSync(outputDir, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && entry.name.startsWith(`${appName}-`))
    .map(entry => path.join(outputDir, entry.name))
    .sort()

  if (packageDirs.length === 0) {
    throw new Error(`Packaged app directory was not found in ${outputDir}`)
  }

  const preferredArch = normalizeArch(process.env.ONEWORKS_DESKTOP_SMOKE_ARCH?.trim() || process.arch)
  const preferredSuffix = `-${preferredArch}`
  const matchedPackageDir = packageDirs.find(packageDir => packageDir.endsWith(preferredSuffix))
  if (matchedPackageDir != null) {
    return matchedPackageDir
  }

  if (packageDirs.length === 1) {
    return packageDirs[0]
  }

  throw new Error(`Unable to resolve packaged app for arch ${preferredArch} in ${outputDir}`)
}

const firstExistingPath = (...candidates) => {
  const found = candidates.find(candidate => fs.existsSync(candidate))
  if (found == null) {
    throw new Error(`None of these paths exist:\n${candidates.join('\n')}`)
  }
  return found
}

const packagedBuiltinPluginRequirements = {
  '@oneworks/plugin-channel-oneworks': [
    'package.json',
    'plugin.json',
    'client/dist/index.js',
    'server/dist/index.js'
  ],
  '@oneworks/plugin-browser-driver': [
    'package.json',
    'plugin.json',
    'bin/browser-driver.cjs',
    'mcp/browser-driver.json',
    'skills/browser-driver/SKILL.md'
  ],
  '@oneworks/plugin-external-browser-driver': [
    'package.json',
    'assets/icon.svg',
    'plugin.json',
    'client/dist/index.js',
    'server/dist/index.js',
    'extension/manifest.json',
    'mcp/external-browser-driver.json',
    'skills/external-browser-driver/SKILL.md'
  ],
  '@oneworks/plugin-cua-driver': [
    'package.json',
    'plugin.json',
    'bin/cua-driver.cjs',
    'client/dist/index.js',
    'mcp/cua-driver.json',
    'server/dist/index.js',
    'skills/cua-driver/SKILL.md'
  ],
  '@oneworks/plugin-logger': [
    'package.json',
    'assets/icon.svg',
    'src/hooks.ts',
    'src/index.ts'
  ],
  '@oneworks/plugin-relay': [
    'package.json',
    'dist/client/index.js',
    'dist/config.cjs',
    'dist/config.js',
    'dist/server/index.js'
  ]
}

const assertPackagedBuiltinPlugins = (appDir) => {
  const requirementPackageNames = Object.keys(packagedBuiltinPluginRequirements).sort()
  const builtinPackageNames = [...BUILTIN_PLUGIN_PACKAGES].sort()
  if (JSON.stringify(requirementPackageNames) !== JSON.stringify(builtinPackageNames)) {
    throw new Error(
      `Packaged built-in plugin requirements are out of sync: ${
        JSON.stringify({ builtinPackageNames, requirementPackageNames })
      }`
    )
  }
  for (const [packageName, requiredPaths] of Object.entries(packagedBuiltinPluginRequirements)) {
    const packageDir = path.join(appDir, 'node_modules', ...packageName.split('/'))
    const missingPaths = requiredPaths.filter(relativePath => !fs.existsSync(path.join(packageDir, relativePath)))
    if (missingPaths.length === 0) continue
    throw new Error(
      `Packaged built-in plugin ${packageName} is missing production entries:\n${
        missingPaths.map(relativePath => path.join(packageDir, relativePath)).join('\n')
      }`
    )
  }
}

const packagedMainSmokeMarker = '[oneworks-desktop] packaged manager smoke ready'

const runPackagedMainSmoke = async (paths) => {
  const smokeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'oneworks-desktop-main-smoke-'))
  const realHomeDir = path.join(smokeRoot, 'home')
  const packageCacheRootDir = path.join(realHomeDir, '.oneworks', 'bootstrap')
  const userDataDir = path.join(smokeRoot, 'user-data')
  fs.mkdirSync(realHomeDir, { recursive: true })
  fs.mkdirSync(userDataDir, { recursive: true })

  try {
    await new Promise((resolve, reject) => {
      const child = spawn(paths.executablePath, [`--user-data-dir=${userDataDir}`], {
        env: {
          ...process.env,
          ONEWORKS_TEST_DESKTOP_PACKAGE_MAIN_SMOKE: '1',
          __ONEWORKS_PROJECT_DISABLE_GLOBAL_CONFIG__: '1',
          __ONEWORKS_PROJECT_PACKAGE_CACHE_DIR__: packageCacheRootDir,
          __ONEWORKS_PROJECT_REAL_HOME__: realHomeDir,
          __IS_LOADER_CLI__: 'true',
          __IS_ONEWORKS_HOOK_LOADER__: 'true',
          __ONEWORKS_CLI_HELPER_LOADER_ACTIVE__: 'true',
          __ONEWORKS_HOOK_LOADER_ACTIVE__: 'true'
        },
        stdio: ['ignore', 'pipe', 'pipe']
      })
      let output = ''
      let settled = false
      const finish = (error) => {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        if (error == null) resolve()
        else reject(error)
      }
      const timeout = setTimeout(() => {
        child.kill('SIGKILL')
        finish(new Error(`Packaged Electron main smoke timed out.\n${output}`))
      }, serverReadyTimeoutMs)

      child.stdout.on('data', chunk => {
        output += chunk
      })
      child.stderr.on('data', chunk => {
        output += chunk
      })
      child.once('error', finish)
      child.once('exit', (code, signal) => {
        if (code !== 0 || signal != null) {
          finish(new Error(`Packaged Electron main smoke exited with code=${code} signal=${signal}.\n${output}`))
          return
        }
        if (!output.includes(packagedMainSmokeMarker)) {
          finish(new Error(`Packaged Electron main smoke did not report readiness.\n${output}`))
          return
        }
        finish()
      })
    })
    assertIsolatedBuiltinPluginCache(paths.appDir, packageCacheRootDir)
  } finally {
    fs.rmSync(smokeRoot, { recursive: true, force: true })
  }
}

const resolvePackagedPaths = () => {
  const packageDir = findPackageDir()

  if (process.platform === 'darwin') {
    const bundleDir = path.join(packageDir, `${appName}.app`)
    const resourcesDir = path.join(bundleDir, 'Contents/Resources')
    const runtimePackageCacheMetadata = readRuntimePackageCacheMetadata(resourcesDir)
    return {
      appDir: path.join(resourcesDir, 'app'),
      clientDistDir: path.join(resourcesDir, 'dist'),
      executablePath: firstExistingPath(
        path.join(bundleDir, 'Contents/MacOS', appMetadata.executableName),
        path.join(bundleDir, 'Contents/MacOS', appMetadata.artifactBaseName)
      ),
      ...runtimePackageCacheMetadata
    }
  }

  const resourcesDir = path.join(packageDir, 'resources')
  const runtimePackageCacheMetadata = readRuntimePackageCacheMetadata(resourcesDir)
  const executableName = process.platform === 'win32'
    ? `${appMetadata.executableName}.exe`
    : appMetadata.executableName
  return {
    appDir: path.join(resourcesDir, 'app'),
    clientDistDir: path.join(resourcesDir, 'dist'),
    executablePath: firstExistingPath(
      path.join(packageDir, executableName),
      path.join(packageDir, `${appName}.exe`)
    ),
    ...runtimePackageCacheMetadata
  }
}

const assertPackagedServerRuntimeBundle = (appDir) => {
  const runtimeDir = path.join(
    appDir,
    'node_modules',
    '@oneworks',
    'server',
    'dist',
    '__INTERNAL__home'
  )
  const entryPath = path.join(runtimeDir, 'index.mjs')
  if (!fs.existsSync(entryPath)) {
    throw new Error(`Packaged server runtime entry is missing: ${entryPath}`)
  }
  const chunksDir = path.join(runtimeDir, 'chunks')
  const chunks = fs.existsSync(chunksDir)
    ? fs.readdirSync(chunksDir).filter(file => file.endsWith('.mjs'))
    : []
  if (chunks.length === 0) {
    throw new Error(`Packaged server runtime split chunks are missing: ${chunksDir}`)
  }
}

const getAvailablePort = () =>
  new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once('error', reject)
    server.listen(0, host, () => {
      const address = server.address()
      server.close(() => {
        if (address == null || typeof address === 'string') {
          reject(new Error('Failed to allocate a smoke test port.'))
          return
        }
        resolve(address.port)
      })
    })
  })

const readLogTail = (logPath, maxLines = 200) => {
  if (!fs.existsSync(logPath)) return 'Packaged server log was not created.'
  const lines = fs.readFileSync(logPath, 'utf8').trimEnd().split(/\r?\n/u)
  return lines.slice(-maxLines).join('\n')
}

const waitForServer = ({ logPath, port, startedAt = Date.now() }) =>
  new Promise((resolve, reject) => {
    let retryScheduled = false
    const request = http.get({
      hostname: host,
      path: '/api/auth/status',
      port,
      timeout: 1000
    }, (response) => {
      let body = ''
      response.setEncoding('utf8')
      response.on('data', chunk => {
        body += chunk
      })
      response.on('end', () => {
        if ((response.statusCode ?? 500) < 500) {
          resolve(body)
          return
        }
        retry()
      })
    })

    const retry = () => {
      if (retryScheduled) return
      retryScheduled = true
      const elapsedMs = Date.now() - startedAt
      if (elapsedMs > serverReadyTimeoutMs) {
        reject(
          new Error(
            `Packaged server did not become ready within ${serverReadyTimeoutMs}ms.\n${readLogTail(logPath)}`
          )
        )
        return
      }
      setTimeout(() => {
        waitForServer({ logPath, port, startedAt }).then(resolve, reject)
      }, 250)
    }

    request.once('timeout', () => {
      request.destroy()
      retry()
    })
    request.once('error', retry)
  })

const readServerText = (port, requestPath, label, options = {}) =>
  new Promise((resolve, reject) => {
    const httpGet = options.httpGet ?? http.get
    const request = httpGet({
      hostname: host,
      path: requestPath,
      port,
      timeout: options.timeoutMs ?? serverRequestTimeoutMs
    }, (response) => {
      let body = ''
      response.setEncoding('utf8')
      response.on('data', chunk => {
        body += chunk
      })
      response.on('end', () => {
        if (response.statusCode !== 200 && !options.allow202) {
          reject(new Error(`${label} returned HTTP ${response.statusCode}: ${body}`))
          return
        }
        resolve(options.returnStatus ? { status: response.statusCode, body } : body)
      })
    })
    request.once('timeout', () => {
      request.destroy(new Error(`${label} request timed out.`))
    })
    request.once('error', reject)
  })

const createPackagedAsset = (port, options = {}) =>
  new Promise((resolve, reject) => {
    const body = JSON.stringify({ kind: 'rule', name: 'Packaged Authority Smoke' })
    const httpRequest = options.httpRequest ?? http.request
    const request = httpRequest({
      headers: {
        'Content-Length': Buffer.byteLength(body),
        'Content-Type': 'application/json'
      },
      hostname: host,
      method: 'POST',
      path: '/api/ai/assets',
      port,
      timeout: options.timeoutMs ?? serverRequestTimeoutMs
    }, (response) => {
      let responseBody = ''
      response.setEncoding('utf8')
      response.on('data', chunk => {
        responseBody += chunk
      })
      response.on('end', () => {
        if (response.statusCode !== 201 && response.statusCode !== 202) {
          reject(new Error(`Packaged asset authority returned HTTP ${response.statusCode}: ${responseBody}`))
          return
        }
        try {
          const parsed = JSON.parse(responseBody)
          Object.defineProperty(parsed, '__status', { value: response.statusCode })
          resolve(parsed)
        } catch {
          reject(new Error(`Packaged asset authority returned invalid JSON: ${responseBody}`))
        }
      })
    })
    request.once('timeout', () => {
      request.destroy(new Error('Packaged asset authority request timed out.'))
    })
    request.once('error', reject)
    request.end(body)
  })

const assertPackagedAssetAuthority = async (port, workspaceFolder) => {
  const initial = await createPackagedAsset(port)
  let response = initial
  if (initial.__status === 202) {
    const operationId = initial?.success === true && initial?.data?.operation?.state === 'pending'
      ? initial.data.operation.id
      : undefined
    if (typeof operationId !== 'string' || operationId.length === 0) {
      throw new Error(`Packaged asset authority returned an invalid pending operation: ${JSON.stringify(initial)}`)
    }
    const deadline = Date.now() + serverRequestTimeoutMs
    let delayMs = 25
    while (Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, delayMs))
      const statusResponse = await readServerText(
        port,
        `/api/ai/assets/operations/${encodeURIComponent(operationId)}?poll=desktop-smoke`,
        'Packaged asset operation status',
        { allow202: true, returnStatus: true }
      )
      const statusBody = statusResponse.body
      let status
      try {
        status = JSON.parse(statusBody)
      } catch {
        throw new Error(`Packaged asset operation returned invalid JSON: ${statusBody}`)
      }
      const returnedOperationId = status?.success === true && status?.data?.operation?.id
      if (
        statusResponse.status === 202 && returnedOperationId === operationId &&
        status?.data?.operation?.state === 'pending'
      ) {
        delayMs = Math.min(delayMs * 2, 250)
        continue
      }
      if (
        statusResponse.status === 200 && status?.success === true && status?.data?.asset?.kind === 'rule' &&
        status?.data?.asset?.path === '.oo/rules/packaged-authority-smoke.md'
      ) {
        response = status
        break
      }
      throw new Error(`Packaged asset operation returned a non-confirmed outcome: ${JSON.stringify(status)}`)
    }
    if (response === initial) {
      throw new Error(`Packaged asset operation did not reach a confirmed state within ${serverRequestTimeoutMs}ms`)
    }
  }
  const relativePath = '.oo/rules/packaged-authority-smoke.md'
  if (
    response?.success !== true || response?.data?.asset?.kind !== 'rule' || response?.data?.asset?.path !== relativePath
  ) {
    throw new Error(`Packaged asset authority returned an unexpected asset: ${JSON.stringify(response)}`)
  }
  const content = fs.readFileSync(path.join(workspaceFolder, relativePath), 'utf8')
  if (!content.includes('# Packaged Authority Smoke')) {
    throw new Error('Packaged asset authority did not publish the expected content.')
  }
}

const parsePluginCatalog = body => {
  try {
    return JSON.parse(body)
  } catch {
    throw new Error('Packaged plugin catalog returned invalid JSON.')
  }
}

const readPluginCatalog = async (port) => (
  parsePluginCatalog(await readServerText(port, '/api/plugins', 'Packaged plugin catalog'))
)

const getCatalogPlugins = catalog => (
  Array.isArray(catalog?.data?.plugins)
    ? catalog.data.plugins
    : Array.isArray(catalog?.plugins)
    ? catalog.plugins
    : []
)

const getCatalogDiagnostics = catalog => [
  ...(Array.isArray(catalog?.diagnostics) ? catalog.diagnostics : []),
  ...(Array.isArray(catalog?.data?.diagnostics) ? catalog.data.diagnostics : [])
]

const privatePluginMetadataKeys = new Set([
  'projecthome',
  'pluginroot',
  'root',
  'rootdir',
  'sourceroot',
  'workspacefolder'
])
const credentialPluginMetadataKeys = new Set([
  'accesstoken',
  'apikey',
  'authorizationheader',
  'bearertoken',
  'clientsecret',
  'credential',
  'credentials',
  'oauthtoken',
  'password',
  'privatekey',
  'refreshtoken',
  'secret',
  'token'
])
const credentialPluginMetadataValuePattern =
  /-----BEGIN [A-Z ]*PRIVATE KEY-----|\bBearer\s+\S+|AIza[\w-]{20,}|A(KIA|SIA)[0-9A-Z]{16}|(github_pat|ghp|gho|ghs|glpat|sk|xox[aboprs])[-\w]{12,}\b|\beyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]{8,}\b|(api[_-]?key|client[_-]?secret|password|token)\s*[:=]\s*\S+/iu

const decodePublicMetadataKey = key => {
  let decodedKey = key
  for (let depth = 0; depth < 8; depth += 1) {
    if (!decodedKey.includes('%')) return decodedKey
    try {
      const nextKey = decodeURIComponent(decodedKey)
      if (nextKey === decodedKey) return undefined
      decodedKey = nextKey
    } catch {
      return undefined
    }
  }
  return decodedKey.includes('%') ? undefined : decodedKey
}

const normalizePublicMetadataKey = key => {
  const decodedKey = decodePublicMetadataKey(key)
  if (decodedKey == null) return undefined
  return decodedKey.normalize('NFKC').replace(/[^a-z0-9]/giu, '').toLowerCase()
}

const isPrivatePluginMetadataKey = key => {
  const normalizedKey = normalizePublicMetadataKey(key)
  if (normalizedKey == null) return true
  return (
    privatePluginMetadataKeys.has(normalizedKey) ||
    credentialPluginMetadataKeys.has(normalizedKey)
  )
}

const isDeclaredCliCommandItem = (value, pathParts) => {
  if (
    value == null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    typeof value.command !== 'string' ||
    typeof value.id !== 'string'
  ) return false
  const pluginPath = pathParts[0] === 'plugins' && /^\d+$/u.test(pathParts[1] ?? '')
    ? pathParts.slice(2)
    : pathParts[0] === 'data' && pathParts[1] === 'plugins' && /^\d+$/u.test(pathParts[2] ?? '')
    ? pathParts.slice(3)
    : undefined
  if (pluginPath == null) return false
  const declaredPaths = [
    ['contributions', 'cliCommands'],
    ['manifest', 'plugin', 'contributions', 'cliCommands'],
    ['plugin', 'contributions', 'cliCommands']
  ]
  return declaredPaths.some(declaredPath => (
    pluginPath.length === declaredPath.length + 1 &&
    declaredPath.every((part, index) => pluginPath[index] === part) &&
    /^\d+$/u.test(pluginPath.at(-1) ?? '')
  ))
}

const containsPrivateMetadataPath = (value, privatePaths = []) => {
  let decodedValue = value
  for (let depth = 0; depth <= 8; depth += 1) {
    if (privatePaths.some(privatePath => privatePath !== '' && decodedValue.includes(privatePath))) return true
    if (!decodedValue.includes('%')) return false
    try {
      const nextValue = decodeURIComponent(decodedValue)
      if (nextValue === decodedValue) return false
      decodedValue = nextValue
    } catch {
      return false
    }
  }
  return false
}

const assertPublicPluginMetadata = (value, options = {}, seen = new WeakSet(), pathParts = []) => {
  if (value == null || typeof value !== 'object') return
  if (seen.has(value)) return
  seen.add(value)

  for (const [key, entryValue] of Object.entries(value)) {
    const normalizedKey = normalizePublicMetadataKey(key)
    const allowsCliRoot = key === 'root' &&
      normalizedKey === 'root' &&
      typeof entryValue === 'boolean' &&
      isDeclaredCliCommandItem(value, pathParts)
    if (!allowsCliRoot && isPrivatePluginMetadataKey(key)) {
      throw new Error('Packaged plugin catalog exposed private metadata.')
    }
    if (
      typeof entryValue === 'string' &&
      containsPrivateMetadataPath(entryValue, options.privatePaths)
    ) {
      throw new Error('Packaged plugin catalog exposed a private local path.')
    }
    if (typeof entryValue === 'string' && credentialPluginMetadataValuePattern.test(entryValue)) {
      throw new Error('Packaged plugin catalog exposed private metadata.')
    }
    assertPublicPluginMetadata(entryValue, options, seen, [...pathParts, key])
  }
}

const readLocalPluginClientSource = (
  port,
  versionedEntryUrl,
  scope,
  options = {}
) =>
  readServerText(
    port,
    `${versionedEntryUrl}?pluginVersion=desktop-smoke`,
    `Packaged local plugin source "${scope}"`,
    {
      ...options,
      timeoutMs: options.timeoutMs ?? serverCompileTimeoutMs
    }
  )

const assertBuiltinRuntimeActive = async (catalog, port, options = {}) => {
  assertPublicPluginMetadata(catalog, options)
  const catalogDiagnostics = getCatalogDiagnostics(catalog)
  if (catalogDiagnostics.length > 0) {
    throw new Error(`Packaged plugin catalog reported ${catalogDiagnostics.length} diagnostics.`)
  }

  const plugins = getCatalogPlugins(catalog)
  const requiredPlugins = []
  for (const packageId of BUILTIN_PLUGIN_PACKAGES) {
    const plugin = plugins.find(candidate => candidate?.packageId === packageId || candidate?.name === packageId)
    if (plugin == null) {
      const packageIds = plugins.map(candidate => candidate?.packageId ?? candidate?.name ?? candidate?.scope)
        .filter(Boolean)
      throw new Error(
        `Packaged plugin catalog does not contain default plugin ${packageId}. ` +
          `Found: ${JSON.stringify(packageIds)}`
      )
    }
    if (plugin.enabled !== true) {
      throw new Error(`Packaged default plugin ${packageId} is present but not enabled.`)
    }
    if (typeof plugin.requestId !== 'string' || typeof plugin.scope !== 'string') {
      throw new TypeError(`Packaged default plugin ${packageId} did not expose its public runtime identity.`)
    }
    if (Array.isArray(plugin.diagnostics) && plugin.diagnostics.length > 0) {
      throw new Error(`Packaged default plugin ${packageId} reported diagnostics.`)
    }
    requiredPlugins.push(plugin)
  }

  for (const plugin of requiredPlugins) {
    if (plugin.client == null) continue
    const packageId = plugin.packageId ?? plugin.name ?? plugin.scope
    if (plugin.client.clientEntryUrl == null) {
      throw new Error(`Packaged built-in plugin ${packageId} did not expose its client production entry.`)
    }
    const entryUrl = new URL(plugin.client.clientEntryUrl, `http://${host}:${port}`)
    await readServerText(
      port,
      `${entryUrl.pathname}${entryUrl.search}`,
      `Packaged built-in plugin ${packageId} client entry`
    )
  }
}

const assertLocalClientSourcesCompile = async (catalog, port) => {
  const requiredScopes = [
    'china-red-theme',
    'neo-workshop-theme',
    'focus-workbench-theme',
    'warm-cowork-theme',
    'chrome'
  ]
  const plugins = getCatalogPlugins(catalog)
  for (const scope of requiredScopes) {
    const plugin = plugins.find(candidate => candidate?.scope === scope)
    if (plugin == null) {
      throw new Error(`Packaged workspace did not discover watched local plugin "${scope}".`)
    }
    const entryUrl = plugin.client?.devClientEntryUrl
    if (
      plugin.watch?.enabled !== true ||
      plugin.client?.devClientEntryKind !== 'runtime-source' ||
      typeof entryUrl !== 'string' ||
      !entryUrl.startsWith(`/api/plugins/${scope}/client-source/`)
    ) {
      throw new Error(`Packaged local plugin "${scope}" did not expose its compiled source entry.`)
    }
    const versionedEntryUrl = entryUrl.replace('/client-source/', '/client-source/@v/desktop-smoke/')
    const source = await readLocalPluginClientSource(
      port,
      versionedEntryUrl,
      scope
    )
    if (!source.includes('activatePlugin')) {
      throw new Error(`Packaged local plugin source "${scope}" is not an executable plugin module.`)
    }
  }
}

const readPackageInfo = (packageDir) => {
  const packageInfoPath = path.join(packageDir, 'package.json')
  const parsed = JSON.parse(fs.readFileSync(packageInfoPath, 'utf8'))
  if (typeof parsed.name !== 'string' || typeof parsed.version !== 'string') {
    throw new TypeError(`Packaged plugin has invalid package metadata: ${packageInfoPath}`)
  }
  return {
    name: parsed.name,
    version: parsed.version
  }
}

const sanitizePackageName = packageName => packageName.replace(/^@/, '').replace(/[\\/]/g, '__')

const assertIsolatedBuiltinPluginCache = (appDir, packageCacheRootDir) => {
  for (const packageName of BUILTIN_PLUGIN_PACKAGES) {
    const packagedPluginDir = path.join(appDir, 'node_modules', ...packageName.split('/'))
    const packageInfo = readPackageInfo(packagedPluginDir)
    for (const cacheVersion of ['latest', packageInfo.version]) {
      const cacheDir = path.join(
        packageCacheRootDir,
        'npm',
        sanitizePackageName(packageName),
        cacheVersion
      )
      const cachedPluginDir = path.join(cacheDir, 'node_modules', ...packageName.split('/'))
      const manifestPath = path.join(cacheDir, '.oneworks-package-cache.json')
      if (!fs.existsSync(cachedPluginDir) || !fs.existsSync(manifestPath)) {
        throw new Error(`Packaged built-in plugin was not materialized in isolated cache: ${cacheDir}`)
      }
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
      if (
        manifest.cacheVersion !== cacheVersion ||
        manifest.name !== packageName ||
        manifest.source !== 'builtin' ||
        manifest.version !== packageInfo.version
      ) {
        throw new Error(`Invalid isolated built-in plugin cache manifest: ${JSON.stringify(manifest)}`)
      }
      const cachedPackageInfo = readPackageInfo(cachedPluginDir)
      if (cachedPackageInfo.name !== packageName || cachedPackageInfo.version !== packageInfo.version) {
        throw new Error(`Isolated built-in plugin cache contains the wrong package: ${cachedPluginDir}`)
      }
    }
  }
}

const assertServerCriticalPathDidNotMaterializeBuiltinPluginCache = (appDir, packageCacheRootDir) => {
  for (const packageName of BUILTIN_PLUGIN_PACKAGES) {
    const packagedPluginDir = path.join(appDir, 'node_modules', ...packageName.split('/'))
    const packageInfo = readPackageInfo(packagedPluginDir)
    for (const cacheVersion of ['latest', packageInfo.version]) {
      const cacheDir = path.join(
        packageCacheRootDir,
        'npm',
        sanitizePackageName(packageName),
        cacheVersion
      )
      if (fs.existsSync(cacheDir)) {
        throw new Error(`Packaged server critical path unexpectedly materialized a built-in plugin: ${cacheDir}`)
      }
    }
  }
}

const runPackagedServerSmoke = async ({
  assertCatalog,
  envOverrides,
  packageCacheRootDir,
  paths,
  realHomeDir,
  smokeLabel,
  workspaceFolder
}) => {
  const port = await getAvailablePort()
  const workspaceEnv = {
    ...createWorkspaceRuntimeEnv(
      paths.runtimePackageCacheVersion,
      paths.runtimePackageBuildFingerprint,
      workspaceFolder,
      realHomeDir,
      packageCacheRootDir
    ),
    ...envOverrides
  }
  const smokeRoot = resolveProjectHomePath(
    workspaceFolder,
    workspaceEnv,
    '.local',
    `desktop-smoke-${smokeLabel}`
  )
  const dataDir = path.join(smokeRoot, 'data')
  const logDir = resolveProjectHomePath(workspaceFolder, workspaceEnv, 'logs', `desktop-smoke-${smokeLabel}`)
  fs.rmSync(smokeRoot, { recursive: true, force: true })
  fs.rmSync(logDir, { recursive: true, force: true })
  fs.mkdirSync(dataDir, { recursive: true })
  fs.mkdirSync(logDir, { recursive: true })

  const logPath = path.join(logDir, 'server.log')
  const logStream = fs.createWriteStream(logPath)
  const child = spawn(paths.executablePath, [path.join(paths.appDir, 'src/server-child.cjs')], {
    cwd: workspaceFolder,
    env: createPackagedServerChildEnv({
      clientDistDir: paths.clientDistDir,
      dataDir,
      dbPath: path.join(smokeRoot, 'db.sqlite'),
      logDir,
      port,
      workspaceEnv
    }),
    stdio: ['ignore', 'pipe', 'pipe']
  })

  child.stdout.pipe(logStream)
  child.stderr.pipe(logStream)

  const exitPromise = new Promise((resolve) => {
    child.once('error', resolve)
    child.once('exit', () => {
      const logText = fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf8') : ''
      resolve(new Error(`Packaged server exited early.\n${logText}`))
    })
  })

  try {
    const result = await Promise.race([
      waitForServer({ logPath, port }),
      exitPromise
    ])
    if (result instanceof Error) throw result
    const pluginCatalog = await readPluginCatalog(port)
    await assertCatalog(pluginCatalog, port)
    return result
  } finally {
    if (!child.killed) {
      child.kill('SIGTERM')
    }
    logStream.end()
  }
}

const createPackagedServerChildEnv = ({
  clientDistDir,
  dataDir,
  dbPath = path.join(dataDir, 'db.sqlite'),
  logDir,
  port,
  workspaceEnv
}) => ({
  ...workspaceEnv,
  DB_PATH: dbPath,
  ELECTRON_RUN_AS_NODE: '1',
  __ONEWORKS_PROJECT_CLI_PREFER_DIST_ENTRY__: 'true',
  __ONEWORKS_PROJECT_CLIENT_BASE__: '/ui',
  __ONEWORKS_PROJECT_CLIENT_DIST_PATH__: clientDistDir,
  __ONEWORKS_PROJECT_CLIENT_MODE__: 'desktop',
  __ONEWORKS_PROJECT_SERVER_DATA_DIR__: dataDir,
  __ONEWORKS_PROJECT_SERVER_HOST__: host,
  __ONEWORKS_PROJECT_SERVER_LOG_DIR__: logDir,
  __ONEWORKS_PROJECT_SERVER_PORT__: String(port),
  __ONEWORKS_PROJECT_WEB_AUTH_ENABLED__: 'false'
})

const main = async () => {
  const paths = resolvePackagedPaths()
  assertPackagedBuiltinPlugins(paths.appDir)
  assertPackagedServerRuntimeBundle(paths.appDir)
  await runPackagedMainSmoke(paths)

  const workspaceResult = await runPackagedServerSmoke({
    assertCatalog: async (pluginCatalog, port) => {
      await assertBuiltinRuntimeActive(pluginCatalog, port, { privatePaths: [workspaceRoot] })
      await assertLocalClientSourcesCompile(pluginCatalog, port)
    },
    paths,
    smokeLabel: 'workspace-dist',
    workspaceFolder: workspaceRoot
  })

  const emptyRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'oneworks-desktop-builtin-smoke-'))
  const emptyWorkspace = path.join(emptyRoot, 'workspace')
  const isolatedHome = path.join(emptyRoot, 'home')
  const isolatedPackageCacheRoot = path.join(isolatedHome, '.oneworks', 'bootstrap')
  fs.mkdirSync(emptyWorkspace, { recursive: true })
  fs.mkdirSync(isolatedHome, { recursive: true })
  fs.writeFileSync(
    path.join(emptyWorkspace, '.oo.config.json'),
    JSON.stringify({
      plugins: BUILTIN_PLUGIN_PACKAGES.map(id => ({ id }))
    })
  )
  try {
    await runPackagedServerSmoke({
      assertCatalog: async (pluginCatalog, port) => {
        await assertBuiltinRuntimeActive(
          pluginCatalog,
          port,
          {
            privatePaths: [paths.appDir, emptyWorkspace, isolatedHome, isolatedPackageCacheRoot]
          }
        )
        await assertPackagedAssetAuthority(port, emptyWorkspace)
      },
      envOverrides: {
        __ONEWORKS_PROJECT_DISABLE_GLOBAL_CONFIG__: '1'
      },
      packageCacheRootDir: isolatedPackageCacheRoot,
      paths,
      realHomeDir: isolatedHome,
      smokeLabel: 'empty-workspace',
      workspaceFolder: emptyWorkspace
    })
    assertServerCriticalPathDidNotMaterializeBuiltinPluginCache(paths.appDir, isolatedPackageCacheRoot)
  } finally {
    fs.rmSync(emptyRoot, { recursive: true, force: true })
  }

  console.log(workspaceResult)
}

module.exports = {
  assertBuiltinRuntimeActive,
  assertPackagedServerRuntimeBundle,
  assertLocalClientSourcesCompile,
  assertPublicPluginMetadata,
  createPackagedAsset,
  createPackagedServerChildEnv,
  parsePluginCatalog,
  readLocalPluginClientSource,
  readServerText,
  serverCompileTimeoutMs,
  serverRequestTimeoutMs,
  resolvePositiveTimeoutMs
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error)
    process.exit(1)
  })
}

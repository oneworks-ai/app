const { existsSync, readFileSync } = require('node:fs')
const Module = require('node:module')
const path = require('node:path')
const process = require('node:process')

const { loadOrTransformSync, resolveCompilerConfigFingerprint } = require('./runtime-transpile-cache')

const ONEWORKS_SOURCE_CONDITION = '__oneworks__'
const packageRuntimeTranspileCache = new Map()
const compilerConfigFingerprintCache = new Map()

const normalizePath = (filename) => filename.split(path.sep).join('/')

const isPlainObject = (value) => (
  value != null &&
  typeof value === 'object' &&
  !Array.isArray(value)
)

const containsOneWorksSourceCondition = (value) => {
  if (Array.isArray(value)) {
    return value.some(containsOneWorksSourceCondition)
  }

  if (!isPlainObject(value)) {
    return false
  }

  if (Object.prototype.hasOwnProperty.call(value, ONEWORKS_SOURCE_CONDITION)) {
    return true
  }

  return Object.values(value).some(containsOneWorksSourceCondition)
}

const packageOptsIntoRuntimeTranspile = (packageJson) => {
  const explicitOptIn = packageJson?.oneworks?.runtimeTranspile

  if (typeof explicitOptIn === 'boolean') {
    return explicitOptIn
  }

  return containsOneWorksSourceCondition(packageJson?.imports) ||
    containsOneWorksSourceCondition(packageJson?.exports)
}

const findNearestPackageJsonPath = (filename) => {
  let currentDir = path.dirname(filename)

  while (true) {
    const packageJsonPath = path.join(currentDir, 'package.json')
    if (existsSync(packageJsonPath)) {
      return packageJsonPath
    }

    const parentDir = path.dirname(currentDir)
    if (parentDir === currentDir) {
      return undefined
    }
    currentDir = parentDir
  }
}

// Files outside node_modules are workspace sources and should always compile.
// Files inside node_modules must opt in through package metadata so third-party
// ESM stays on Node's native loader path.
const shouldCompileWithEsbuild = (filename) => {
  const normalizedFilename = normalizePath(filename)
  if (!normalizedFilename.includes('/node_modules/')) {
    return true
  }

  const packageJsonPath = findNearestPackageJsonPath(filename)
  if (packageJsonPath == null) {
    return false
  }

  const cached = packageRuntimeTranspileCache.get(packageJsonPath)
  if (cached != null) {
    return cached
  }

  let shouldCompile = false

  try {
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'))
    shouldCompile = packageOptsIntoRuntimeTranspile(packageJson)
  } catch {
    shouldCompile = false
  }

  packageRuntimeTranspileCache.set(packageJsonPath, shouldCompile)
  return shouldCompile
}

const isRelativeOrAbsoluteRequest = (request) => (
  typeof request === 'string' &&
  (
    request.startsWith('./') ||
    request.startsWith('../') ||
    path.isAbsolute(request)
  )
)

const isDirectModuleNotFound = (error, request) => (
  error != null &&
  typeof error === 'object' &&
  error.code === 'MODULE_NOT_FOUND' &&
  typeof error.message === 'string' &&
  error.message.includes(`'${request}'`)
)

const originalResolveFilename = Module._resolveFilename

Module._resolveFilename = function patchedResolveFilename(request, parent, isMain, options) {
  try {
    return originalResolveFilename.call(this, request, parent, isMain, options)
  } catch (error) {
    if (!isDirectModuleNotFound(error, request)) {
      throw error
    }

    if (!isRelativeOrAbsoluteRequest(request) || !request.endsWith('.js')) {
      throw error
    }

    const stem = request.slice(0, -3)
    const candidates = [
      `${stem}.ts`,
      `${stem}.tsx`,
      `${stem}.mts`,
      `${stem}.cts`
    ]

    for (const candidate of candidates) {
      try {
        return originalResolveFilename.call(this, candidate, parent, isMain, options)
      } catch (candidateError) {
        if (!isDirectModuleNotFound(candidateError, candidate)) {
          throw candidateError
        }
      }
    }

    throw error
  }
}

const transformVersion = require('esbuild/package.json').version
const registerOptions = {
  target: `node${process.version.slice(1)}`,
  hookIgnoreNodeModules: false,
  hookMatcher: shouldCompileWithEsbuild
}

const getCompilerConfigFingerprint = filename => {
  const directory = path.dirname(filename)
  const cached = compilerConfigFingerprintCache.get(directory)
  if (cached != null) return cached
  const fingerprint = resolveCompilerConfigFingerprint(filename)
  compilerConfigFingerprintCache.set(directory, fingerprint)
  return fingerprint
}

require('esbuild-register/dist/node.js').register(registerOptions)

// Keep esbuild-register as the canonical compiler so tsconfig discovery,
// source maps, import.meta.url handling, and CommonJS compatibility do not
// drift. The wrapper only memoizes the generated JavaScript between the
// short-lived desktop service processes used by warm startup.
for (const extension of ['.cts', '.mts', '.ts', '.tsx']) {
  const registeredHandler = Module._extensions[extension]
  Module._extensions[extension] = function compileCachedOneWorksTypescript(module, filename) {
    if (!shouldCompileWithEsbuild(filename)) {
      return registeredHandler.call(this, module, filename)
    }

    const source = readFileSync(filename, 'utf8')
    const compiled = loadOrTransformSync({
      code: source,
      compilerConfigFingerprint: getCompilerConfigFingerprint(filename),
      filename,
      options: registerOptions,
      transform: () => {
        let compiledCode
        registeredHandler.call(this, {
          _compile(code) {
            compiledCode = code
          }
        }, filename)
        if (typeof compiledCode !== 'string') {
          throw new TypeError(`esbuild-register did not compile ${filename}`)
        }
        return compiledCode
      },
      transformVersion
    })
    module._compile(compiled, filename)
  }
}

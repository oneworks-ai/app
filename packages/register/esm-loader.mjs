/* eslint-disable max-lines -- ESM loader keeps resolver and transpiler hooks together. */
import { existsSync, readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { transform } from 'esbuild'

const ONEWORKS_SOURCE_CONDITION = '__oneworks__'
const packageRuntimeTranspileCache = new Map()

const normalizePath = filename => filename.split(path.sep).join('/')

const isPlainObject = value => (
  value != null &&
  typeof value === 'object' &&
  !Array.isArray(value)
)

const containsOneWorksSourceCondition = value => {
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

const packageOptsIntoRuntimeTranspile = packageJson => {
  const explicitOptIn = packageJson?.oneworks?.runtimeTranspile

  if (typeof explicitOptIn === 'boolean') {
    return explicitOptIn
  }

  return containsOneWorksSourceCondition(packageJson?.imports) ||
    containsOneWorksSourceCondition(packageJson?.exports)
}

const findNearestPackageJsonPath = filename => {
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

const shouldCompileWithEsbuild = filename => {
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

const isTypescriptUrl = url => /\.(?:ts|tsx|mts|cts)$/u.test(url)

const toSourceLoader = filename => {
  const extension = path.extname(filename)
  if (extension === '.tsx') return 'tsx'
  return 'ts'
}

const esmNodeGlobalsBanner = [
  'import { dirname as __oneworksEsmDirname } from "node:path";',
  'import { fileURLToPath as __oneworksEsmFileURLToPath } from "node:url";',
  'const __filename = __oneworksEsmFileURLToPath(import.meta.url);',
  'const __dirname = __oneworksEsmDirname(__filename);'
].join('\n')

const loadJsonAsEsm = async filename => {
  const parsed = JSON.parse(await readFile(filename, 'utf8'))
  return {
    format: 'module',
    shortCircuit: true,
    source: `export default ${JSON.stringify(parsed)};\n`
  }
}

const isRelativeOrAbsoluteSpecifier = specifier => (
  specifier.startsWith('.') ||
  specifier.startsWith('/') ||
  specifier.startsWith('file:')
)

const specifierPath = specifier => {
  if (!specifier.startsWith('file:')) {
    return specifier
  }

  try {
    return fileURLToPath(specifier)
  } catch {
    return specifier
  }
}

const explicitRuntimeExtensions = new Set([
  '.cjs',
  '.cts',
  '.js',
  '.json',
  '.mjs',
  '.mts',
  '.node',
  '.ts',
  '.tsx'
])

const hasExplicitRuntimeExtension = specifier => explicitRuntimeExtensions.has(path.extname(specifierPath(specifier)))

const shouldTrySourceCandidates = error => (
  error?.code === 'ERR_MODULE_NOT_FOUND' ||
  error?.code === 'ERR_UNSUPPORTED_DIR_IMPORT'
)

const candidateSpecifierUrls = specifier => {
  if (specifier.endsWith('.js')) {
    const stem = specifier.slice(0, -3)
    return [
      `${stem}.ts`,
      `${stem}.tsx`,
      `${stem}.mts`,
      `${stem}.cts`
    ]
  }

  if (!isRelativeOrAbsoluteSpecifier(specifier) || hasExplicitRuntimeExtension(specifier)) {
    return []
  }

  return [
    `${specifier}.ts`,
    `${specifier}.tsx`,
    `${specifier}.mts`,
    `${specifier}.cts`,
    `${specifier}/index.ts`,
    `${specifier}/index.tsx`,
    `${specifier}/index.mts`,
    `${specifier}/index.cts`
  ]
}

const resolveCandidateSpecifier = (specifier, parentURL) => {
  if (specifier.startsWith('file:')) {
    return pathToFileURL(fileURLToPath(specifier)).href
  }

  if (specifier.startsWith('/') && parentURL?.startsWith('file:')) {
    return pathToFileURL(specifier).href
  }

  return undefined
}

export async function resolve(specifier, context, defaultResolve) {
  try {
    return await defaultResolve(specifier, context, defaultResolve)
  } catch (error) {
    if (!shouldTrySourceCandidates(error)) {
      throw error
    }

    for (const candidate of candidateSpecifierUrls(specifier)) {
      const candidateUrl = resolveCandidateSpecifier(candidate, context.parentURL)
      if (candidateUrl != null && existsSync(fileURLToPath(candidateUrl))) {
        return {
          shortCircuit: true,
          url: candidateUrl
        }
      }

      try {
        return await defaultResolve(candidate, context, defaultResolve)
      } catch (candidateError) {
        if (!shouldTrySourceCandidates(candidateError)) {
          throw candidateError
        }
      }
    }

    throw error
  }
}

export async function load(url, context, defaultLoad) {
  if (url.startsWith('file:') && isTypescriptUrl(url)) {
    const filename = fileURLToPath(url)
    if (shouldCompileWithEsbuild(filename)) {
      const isCommonJsTypescript = path.extname(filename) === '.cts'
      const result = await transform(await readFile(filename, 'utf8'), {
        ...(isCommonJsTypescript ? {} : { banner: esmNodeGlobalsBanner }),
        format: isCommonJsTypescript ? 'cjs' : 'esm',
        loader: toSourceLoader(filename),
        sourcemap: 'inline',
        sourcefile: filename,
        target: `node${process.version.slice(1)}`
      })
      return {
        format: isCommonJsTypescript ? 'commonjs' : 'module',
        shortCircuit: true,
        source: result.code
      }
    }
  }

  if (url.startsWith('file:') && url.endsWith('.json')) {
    const filename = fileURLToPath(url)
    if (shouldCompileWithEsbuild(filename)) {
      return await loadJsonAsEsm(filename)
    }
  }

  return await defaultLoad(url, context, defaultLoad)
}

import { access, cp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'

const require = createRequire(import.meta.url)
const defaultRelayRoot = join(import.meta.dirname, '..')
const defaultRuntimePackages = [
  'postgres',
  '@simplewebauthn/server',
  '@oneworks/icon',
  '@oneworks/types'
]

const getOutputLayout = (relayDirectory) => {
  const functionRoot = join(relayDirectory, '.vercel/output/functions/api/relay.func')
  return {
    functionConfigPath: join(functionRoot, '.vc-config.json'),
    functionNodeModules: join(functionRoot, 'node_modules')
  }
}

export const findPackageRoot = async (packageName, fromPaths) => {
  let current = dirname(require.resolve(packageName, { paths: fromPaths }))
  while (current !== dirname(current)) {
    const packageJson = join(current, 'package.json')
    try {
      await access(packageJson)
      const packageInfo = JSON.parse(await readFile(packageJson, 'utf8'))
      if (packageInfo.name === packageName) return current
    } catch {
      // Keep walking until the package root is found.
    }
    current = dirname(current)
  }
  throw new Error(`Could not find package root for ${packageName}`)
}

const copyPackage = async ({ excludeNodeModules, functionNodeModules, packageName, packageRoot }) => {
  const source = await realpath(packageRoot)
  const sourceNodeModules = join(source, 'node_modules')
  const target = join(functionNodeModules, packageName)
  await rm(target, { force: true, recursive: true })
  await mkdir(dirname(target), { recursive: true })
  await cp(source, target, {
    dereference: true,
    filter: excludeNodeModules ? (candidate) => candidate !== sourceNodeModules : undefined,
    recursive: true
  })
  console.log(`[relay-server] Vercel function dependency copied: ${packageName}`)
}

const readPackageDependencies = async (packageName, fromPaths, packageRootOverrides) => {
  const packageRoot = packageRootOverrides.get(packageName) ?? await findPackageRoot(packageName, fromPaths)
  const packageInfo = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'))
  return {
    dependencies: Object.keys({
      ...(packageInfo.dependencies ?? {}),
      ...(packageInfo.optionalDependencies ?? {})
    }),
    packageRoot
  }
}

export const collectRuntimePackages = async (
  packageNames,
  { collected = new Map(), fromPaths, packageRootOverrides = new Map() }
) => {
  for (const packageName of packageNames) {
    if (collected.has(packageName)) continue
    const { dependencies, packageRoot } = await readPackageDependencies(
      packageName,
      fromPaths,
      packageRootOverrides
    )
    collected.set(packageName, packageRoot)
    await collectRuntimePackages(dependencies, {
      collected,
      fromPaths: [packageRoot],
      packageRootOverrides
    })
  }
  return collected
}

export async function prepareVercelOutput({
  packageRootOverrides,
  relayDirectory = defaultRelayRoot,
  runtimePackages = defaultRuntimePackages
} = {}) {
  const resolvedPackageRootOverrides = packageRootOverrides ?? new Map([
    ['@oneworks/icon', join(relayDirectory, '..', '..', 'packages', 'icon')],
    ['@oneworks/types', join(relayDirectory, '..', '..', 'packages', 'types')]
  ])
  const { functionConfigPath, functionNodeModules } = getOutputLayout(relayDirectory)
  await mkdir(functionNodeModules, { recursive: true })
  const copiedPackages = await collectRuntimePackages(runtimePackages, {
    fromPaths: [relayDirectory],
    packageRootOverrides: resolvedPackageRootOverrides
  })
  for (const [packageName, packageRoot] of copiedPackages.entries()) {
    await copyPackage({
      excludeNodeModules: resolvedPackageRootOverrides.has(packageName),
      functionNodeModules,
      packageName,
      packageRoot
    })
  }

  const config = JSON.parse(await readFile(functionConfigPath, 'utf8'))
  if (config.filePathMap != null) {
    for (const packageName of copiedPackages.keys()) {
      const packagePath = `node_modules/${packageName}`
      for (const key of Object.keys(config.filePathMap)) {
        if (key === packagePath || key.startsWith(`${packagePath}/`)) {
          delete config.filePathMap[key]
        }
      }
    }
    await writeFile(functionConfigPath, `${JSON.stringify(config, null, 2)}\n`)
    console.log('[relay-server] Vercel function dependency filePathMap cleaned')
  }
  return copiedPackages
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await prepareVercelOutput()
}

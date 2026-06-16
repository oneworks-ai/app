import { access, cp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

const require = createRequire(import.meta.url)
const root = join(import.meta.dirname, '..')
const functionRoot = join(root, '.vercel/output/functions/api/relay.func')
const functionNodeModules = join(functionRoot, 'node_modules')
const functionConfigPath = join(functionRoot, '.vc-config.json')
const runtimePackages = ['postgres', '@simplewebauthn/server']

const findPackageRoot = async (packageName, fromPaths = [root]) => {
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

const copyPackage = async (packageName, packageRoot) => {
  const source = await realpath(packageRoot)
  const target = join(functionNodeModules, packageName)
  await rm(target, { force: true, recursive: true })
  await mkdir(dirname(target), { recursive: true })
  await cp(source, target, { dereference: true, recursive: true })
  console.log(`[relay-server] Vercel function dependency copied: ${packageName}`)
}

const readPackageDependencies = async (packageName, fromPaths) => {
  const packageRoot = await findPackageRoot(packageName, fromPaths)
  const packageInfo = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'))
  return {
    dependencies: Object.keys({
      ...(packageInfo.dependencies ?? {}),
      ...(packageInfo.optionalDependencies ?? {})
    }),
    packageRoot
  }
}

const collectRuntimePackages = async (packageNames, fromPaths = [root], collected = new Map()) => {
  for (const packageName of packageNames) {
    if (collected.has(packageName)) continue
    const { dependencies, packageRoot } = await readPackageDependencies(packageName, fromPaths)
    collected.set(packageName, packageRoot)
    await collectRuntimePackages(dependencies, [packageRoot], collected)
  }
  return collected
}

await mkdir(functionNodeModules, { recursive: true })
const copiedPackages = await collectRuntimePackages(runtimePackages)
for (const [packageName, packageRoot] of copiedPackages.entries()) {
  await copyPackage(packageName, packageRoot)
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

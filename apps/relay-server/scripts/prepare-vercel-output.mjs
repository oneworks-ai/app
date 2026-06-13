import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { access, cp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'

const require = createRequire(import.meta.url)
const root = join(import.meta.dirname, '..')
const functionRoot = join(root, '.vercel/output/functions/api/relay.func')
const functionNodeModules = join(functionRoot, 'node_modules')
const functionConfigPath = join(functionRoot, '.vc-config.json')
const runtimePackages = ['postgres']

const findPackageRoot = async packageName => {
  let current = dirname(require.resolve(packageName))
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

const copyPackage = async packageName => {
  const source = await realpath(await findPackageRoot(packageName))
  const target = join(functionNodeModules, packageName)
  await rm(target, { force: true, recursive: true })
  await mkdir(dirname(target), { recursive: true })
  await cp(source, target, { dereference: true, recursive: true })
  console.log(`[relay-server] Vercel function dependency copied: ${packageName}`)
}

await mkdir(functionNodeModules, { recursive: true })
for (const packageName of runtimePackages) {
  await copyPackage(packageName)
}

const config = JSON.parse(await readFile(functionConfigPath, 'utf8'))
if (config.filePathMap != null) {
  for (const packageName of runtimePackages) {
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

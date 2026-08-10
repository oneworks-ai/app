import { cp, mkdir, mkdtemp, rename, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'

const relayRoot = join(import.meta.dirname, '..')

const packageTarget = (root, packageName) => join(root, 'node_modules', ...packageName.split('/'))

export const getVercelRuntimeWorkspacePackages = (relayDirectory = relayRoot) => [
  {
    packageName: '@oneworks/icon',
    sourceDirectory: join(relayDirectory, '..', '..', 'packages', 'icon')
  },
  {
    packageName: '@oneworks/types',
    sourceDirectory: join(relayDirectory, '..', '..', 'packages', 'types')
  }
]

export async function materializeVercelWorkspacePackage({
  packageName,
  relayDirectory = relayRoot,
  sourceDirectory
}) {
  const target = packageTarget(relayDirectory, packageName)
  const targetParent = dirname(target)
  await mkdir(targetParent, { recursive: true })

  const stagingRoot = await mkdtemp(join(targetParent, '.oneworks-vercel-runtime-'))
  const stagedPackage = join(stagingRoot, 'package')
  try {
    await cp(sourceDirectory, stagedPackage, {
      filter: (source) => source !== join(sourceDirectory, 'node_modules'),
      recursive: true
    })
    await rm(target, { force: true, recursive: true })
    await rename(stagedPackage, target)
  } finally {
    await rm(stagingRoot, { force: true, recursive: true })
  }

  console.log(`[relay-server] Vercel runtime workspace package materialized: ${packageName}`)
  return target
}

export async function materializeVercelRuntime(
  env = process.env,
  { relayDirectory = relayRoot } = {}
) {
  const isCi = env.CI === '1' || env.CI?.toLowerCase() === 'true'
  if (env.VERCEL !== '1' || !isCi) {
    console.log('[relay-server] Skipping Vercel runtime materialization outside hosted CI build.')
    return []
  }
  const materializedPackages = []
  for (const runtimePackage of getVercelRuntimeWorkspacePackages(relayDirectory)) {
    materializedPackages.push(
      await materializeVercelWorkspacePackage({
        ...runtimePackage,
        relayDirectory
      })
    )
  }
  return materializedPackages
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await materializeVercelRuntime()
}

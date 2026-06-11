import { cp, mkdir, rm, symlink } from 'node:fs/promises'
import { basename, resolve } from 'node:path'

import { resolveProjectOoPath } from '@oneworks/utils'
import { listManagedPluginInstalls } from '@oneworks/utils/managed-plugin'

const toSlug = (value: string) => (
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'plugin'
)

const linkOrCopyDirectory = async (sourceDir: string, targetDir: string) => {
  try {
    await symlink(sourceDir, targetDir, 'dir')
  } catch {
    await cp(sourceDir, targetDir, { recursive: true })
  }
}

export const stageClaudePluginDirs = async (params: {
  cwd: string
  ctxId: string
  env: Record<string, string | null | undefined>
  sessionId: string
}) => {
  const installs = await listManagedPluginInstalls(params.cwd, {
    adapter: 'claude',
    env: params.env as NodeJS.ProcessEnv
  })
  if (installs.length === 0) return []

  const runtimeRoot = resolveProjectOoPath(
    params.cwd,
    params.env as NodeJS.ProcessEnv,
    'caches',
    params.ctxId,
    params.sessionId,
    '.claude-plugins'
  )
  await rm(runtimeRoot, { recursive: true, force: true })
  await mkdir(runtimeRoot, { recursive: true })

  const pluginDirs: string[] = []
  for (const install of installs) {
    const targetDir = resolve(runtimeRoot, `${toSlug(install.config.name)}-${basename(install.installDir)}`)
    await linkOrCopyDirectory(install.nativePluginDir, targetDir)
    pluginDirs.push(targetDir)
  }

  return pluginDirs
}

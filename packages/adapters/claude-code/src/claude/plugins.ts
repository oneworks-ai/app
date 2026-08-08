import { cp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { basename, dirname, resolve } from 'node:path'

import type { AdapterCtx } from '@oneworks/types'
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
  skills?: NonNullable<AdapterCtx['assets']>['skills']
}) => {
  const installs = await listManagedPluginInstalls(params.cwd, {
    adapter: 'claude',
    env: params.env as NodeJS.ProcessEnv
  })
  if (installs.length === 0 && (params.skills?.length ?? 0) === 0) return []

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

  if ((params.skills?.length ?? 0) > 0) {
    const workspacePluginDir = resolve(runtimeRoot, 'oneworks-workspace-skills')
    const workspaceSkillsDir = resolve(workspacePluginDir, 'skills')
    await mkdir(resolve(workspacePluginDir, '.claude-plugin'), { recursive: true })
    await mkdir(workspaceSkillsDir, { recursive: true })
    await writeFile(
      resolve(workspacePluginDir, '.claude-plugin', 'plugin.json'),
      `${JSON.stringify({ name: 'oneworks-workspace-skills', version: '1.0.0' }, null, 2)}\n`,
      'utf8'
    )

    const usedNames = new Set<string>()
    for (const skill of params.skills ?? []) {
      const baseName = toSlug(skill.displayName.replaceAll('/', '__'))
      let targetName = baseName
      let suffix = 2
      while (usedNames.has(targetName)) targetName = `${baseName}-${suffix++}`
      usedNames.add(targetName)
      await linkOrCopyDirectory(dirname(skill.sourcePath), resolve(workspaceSkillsDir, targetName))
    }
    pluginDirs.push(workspacePluginDir)
  }

  return pluginDirs
}

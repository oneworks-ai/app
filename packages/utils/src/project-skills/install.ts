/* eslint-disable max-lines -- project skill installation centralizes atomic writes, dependencies, and lockfile policy. */
import { mkdir, mkdtemp, rename, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import process from 'node:process'

import type {
  ConfiguredSkillCollectionConfig,
  ConfiguredSkillIncludeConfig,
  ConfiguredSkillInstallConfig,
  SkillsCliConfig
} from '@oneworks/types'

import { resolveProjectOoPath } from '../ai-path'
import { withDirectoryInstallLock } from '../install-lock'
import { migrateProjectHomeSegment, removeLegacyProjectHomeSegmentPath } from '../project-home-migration'
import {
  findSkillsCli,
  installSkillsCliRefToTemp,
  installSkillsCliSkillToTemp,
  installSkillsCliSourceToTemp,
  listInstalledSkillDirs,
  toSkillSlug
} from '../skills-cli'
import { DEFAULT_MAX_BUFFER, buildSkillsCliEnv, execFileAsync } from '../skills-cli/shared'
import { formatSkillsSpec } from '../skills-spec'
import { assertSkillDirectoryUnchanged, computeSkillDirectoryHash } from './lockfile'
import { isWildcardSkillInclude, normalizeProjectSkillInstall } from './normalize'
import { copyRegularFiles, pathExists, rewriteInstalledSkillName } from './shared'
import type { NormalizedProjectSkillInstall } from './types'

const pickSearchResult = (results: Awaited<ReturnType<typeof findSkillsCli>>, name: string) => {
  const slug = toSkillSlug(name)
  return results.find(result => (
    result.skill === name ||
    toSkillSlug(result.skill) === slug
  )) ?? results[0]
}

const buildInstalledSkillResult = (params: {
  hash: string
  installDir: string
  normalized: NormalizedProjectSkillInstall
}) => ({
  dirName: params.normalized.targetDirName,
  hash: params.hash,
  installDir: params.installDir,
  name: params.normalized.targetName,
  ref: params.normalized.ref,
  skillPath: join(params.installDir, 'SKILL.md')
})
type InstalledProjectSkillResult = ReturnType<typeof buildInstalledSkillResult>

const withInstallLock = async <T>(lockDir: string, callback: () => Promise<T>) => {
  try {
    return await withDirectoryInstallLock({ lockDir }, callback)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(
      message.replace('Timed out waiting for install lock', 'Timed out waiting for project skill install lock')
    )
  }
}

const toTempInstallPrefix = (segments: string[] | undefined, targetDirName: string) => (
  [...(segments ?? []), targetDirName]
    .map(segment => segment.replace(/[^\w.-]+/g, '-'))
    .filter(Boolean)
    .join('-')
)

const normalizeCollectionInclude = (
  value: ConfiguredSkillIncludeConfig
) => {
  if (typeof value === 'string') {
    return {
      name: value.trim()
    }
  }

  return {
    name: value.name.trim(),
    ...(value.rename == null || value.rename.trim() === '' ? {} : { rename: value.rename.trim() }),
    ...(value.version == null || value.version.trim() === '' ? {} : { version: value.version.trim() })
  }
}

const resolveCollectionInclude = (
  includes: ConfiguredSkillCollectionConfig['include'],
  skill: { dirName: string; name: string }
) => {
  if (includes == null || includes.length === 0 || includes.some(isWildcardSkillInclude)) {
    return {
      name: skill.name
    }
  }

  const skillSlug = toSkillSlug(skill.name)
  return includes
    .map(normalizeCollectionInclude)
    .find(include => (
      include.name === skill.name ||
      include.name === skill.dirName ||
      toSkillSlug(include.name) === skillSlug ||
      toSkillSlug(include.name) === toSkillSlug(skill.dirName)
    ))
}

const buildCollectionNormalizedSkill = (params: {
  include?: ReturnType<typeof normalizeCollectionInclude>
  registry?: string
  skill: { dirName: string; name: string }
  source: string
  version?: string
}): NormalizedProjectSkillInstall => {
  const name = params.skill.name
  const version = params.include?.version ?? params.version
  const rename = params.include?.rename
  const targetName = rename ?? name
  const targetDirName = toSkillSlug(targetName)

  return {
    ref: formatSkillsSpec({
      name,
      registry: params.registry,
      source: params.source,
      version
    }),
    name,
    ...(params.registry == null ? {} : { registry: params.registry }),
    source: params.source,
    ...(version == null ? {} : { version }),
    ...(rename == null ? {} : { rename }),
    targetName,
    targetDirName
  }
}

const looksLikeNpmPackageSource = (source: string) => source.startsWith('@')

const installNpmPackageSkillsToTemp = async (params: {
  config?: SkillsCliConfig
  registry?: string
  source: string
  version?: string
}) => {
  const tempDir = await mkdtemp(join(tmpdir(), 'ow-skills-npm-source-'))
  const extractDir = join(tempDir, 'extract')
  const packageSpec = params.version == null || params.version.trim() === ''
    ? params.source
    : `${params.source}@${params.version}`
  const env = {
    ...process.env,
    ...buildSkillsCliEnv({
      config: params.config,
      registry: params.registry
    })
  }

  try {
    const { stdout } = await execFileAsync(
      params.config?.npmPath?.trim() || 'npm',
      ['pack', packageSpec, '--json', '--pack-destination', tempDir],
      {
        cwd: tempDir,
        env,
        maxBuffer: DEFAULT_MAX_BUFFER
      }
    )
    const packResult = JSON.parse(stdout) as Array<{ filename?: string }>
    const filename = packResult[0]?.filename
    if (filename == null || filename.trim() === '') {
      throw new Error(`npm pack did not return a tarball for ${params.source}.`)
    }

    await mkdir(extractDir, { recursive: true })
    await execFileAsync('tar', ['-xzf', join(tempDir, filename), '-C', extractDir], {
      cwd: tempDir,
      env,
      maxBuffer: DEFAULT_MAX_BUFFER
    })

    const installedSkills = await listInstalledSkillDirs({
      installedSkillsDir: join(extractDir, 'package', 'skills')
    })
    if (installedSkills.length === 0) {
      throw new Error(`npm package ${params.source} did not contain skills.`)
    }

    return {
      installedSkills,
      tempDir
    }
  } catch (error) {
    await rm(tempDir, { recursive: true, force: true })
    throw error
  }
}

export const installProjectSkill = async (params: {
  commit?: (result: InstalledProjectSkillResult) => Promise<void>
  config?: SkillsCliConfig
  expectedHash?: string
  env?: NodeJS.ProcessEnv
  force?: boolean
  installPathSegments?: string[]
  registry?: string
  skill: NormalizedProjectSkillInstall | string | ConfiguredSkillInstallConfig
  workspaceFolder: string
}) => {
  const normalized = typeof params.skill === 'string'
    ? normalizeProjectSkillInstall(params.skill)
    : ('targetDirName' in params.skill
      ? params.skill
      : normalizeProjectSkillInstall(params.skill))

  if (normalized == null) {
    throw new Error('Skill reference is required.')
  }

  const projectEnv = params.env ?? process.env
  await migrateProjectHomeSegment(params.workspaceFolder, projectEnv, 'caches')

  const installDir = resolveProjectOoPath(
    params.workspaceFolder,
    projectEnv,
    'skills',
    ...(params.installPathSegments ?? []),
    normalized.targetDirName
  )
  const skillPath = join(installDir, 'SKILL.md')
  const tempInstallDir = resolveProjectOoPath(
    params.workspaceFolder,
    projectEnv,
    'caches',
    'project-skill-installs',
    `${toTempInstallPrefix(params.installPathSegments, normalized.targetDirName)}.tmp-${process.pid}-${Date.now()}-${
      Math.random().toString(36).slice(2)
    }`
  )
  const lockDir = resolveProjectOoPath(
    params.workspaceFolder,
    projectEnv,
    'caches',
    'project-skill-installs',
    'locks',
    ...(params.installPathSegments ?? []),
    normalized.targetDirName
  )

  const installed = await withInstallLock(lockDir, async () => {
    if (params.force !== true && await pathExists(skillPath)) {
      await assertSkillDirectoryUnchanged({
        expectedHash: params.expectedHash,
        installDir
      })
      const result = buildInstalledSkillResult({
        hash: await computeSkillDirectoryHash(installDir),
        installDir,
        normalized
      })
      await params.commit?.(result)
      return result
    }

    await assertSkillDirectoryUnchanged({
      expectedHash: params.expectedHash,
      installDir
    })

    const installResult = normalized.source != null
      ? await installSkillsCliSkillToTemp({
        cacheCwd: params.workspaceFolder,
        config: params.config,
        registry: params.registry ?? normalized.registry,
        skill: normalized.name,
        source: normalized.source,
        version: normalized.version
      })
      : await (async () => {
        const searchResults = await findSkillsCli({
          cacheCwd: params.workspaceFolder,
          config: params.config,
          registry: params.registry ?? normalized.registry,
          query: normalized.name
        })
        const selected = pickSearchResult(searchResults, normalized.name)
        if (selected == null) {
          throw new Error(`Skill ${normalized.name} was not found by the skills CLI search.`)
        }

        return normalized.version == null
          ? await installSkillsCliRefToTemp({
            cacheCwd: params.workspaceFolder,
            config: params.config,
            registry: params.registry ?? normalized.registry,
            installRef: selected.installRef
          })
          : await installSkillsCliSkillToTemp({
            cacheCwd: params.workspaceFolder,
            config: params.config,
            registry: params.registry ?? normalized.registry,
            skill: selected.skill,
            source: selected.source,
            version: normalized.version
          })
      })()

    try {
      await rm(tempInstallDir, { recursive: true, force: true })
      await mkdir(dirname(tempInstallDir), { recursive: true })
      await mkdir(tempInstallDir, { recursive: true })
      await copyRegularFiles(installResult.installedSkill.sourcePath, tempInstallDir)

      const tempSkillPath = join(tempInstallDir, 'SKILL.md')
      if (!await pathExists(tempSkillPath)) {
        throw new Error(`Configured skill ${normalized.ref} did not include SKILL.md`)
      }
      await rewriteInstalledSkillName(tempSkillPath, normalized.targetName)

      const backupDir = `${tempInstallDir}.backup`
      await rm(backupDir, { recursive: true, force: true })
      await mkdir(dirname(installDir), { recursive: true })
      const hadPreviousInstall = await pathExists(installDir)
      if (hadPreviousInstall) await rename(installDir, backupDir)
      let installedReplacement = false
      try {
        await rename(tempInstallDir, installDir)
        installedReplacement = true
        const result = buildInstalledSkillResult({
          hash: await computeSkillDirectoryHash(installDir),
          installDir,
          normalized
        })
        await params.commit?.(result)
        if (hadPreviousInstall) {
          await rm(backupDir, { recursive: true, force: true }).catch(() => undefined)
        }
        return result
      } catch (error) {
        if (installedReplacement) await rm(installDir, { recursive: true, force: true })
        if (hadPreviousInstall) await rename(backupDir, installDir)
        throw error
      }
    } catch (error) {
      await rm(tempInstallDir, { recursive: true, force: true })
      throw error
    } finally {
      await rm(installResult.tempDir, { recursive: true, force: true })
    }
  })

  await removeLegacyProjectHomeSegmentPath(
    params.workspaceFolder,
    projectEnv,
    'caches',
    'project-skill-installs',
    'locks',
    ...(params.installPathSegments ?? []),
    normalized.targetDirName
  )
  return installed
}

export const installProjectSkillCollection = async (params: {
  config?: SkillsCliConfig
  env?: NodeJS.ProcessEnv
  expectedHashes?: Record<string, string | undefined>
  force?: boolean
  include?: ConfiguredSkillCollectionConfig['include']
  installPathSegments?: string[]
  registry?: string
  source: string
  version?: string
  workspaceFolder: string
}) => {
  const source = params.source.trim()
  if (source === '') {
    throw new Error('Skill source is required.')
  }

  const projectEnv = params.env ?? process.env
  await migrateProjectHomeSegment(params.workspaceFolder, projectEnv, 'caches')

  const lockDir = resolveProjectOoPath(
    params.workspaceFolder,
    projectEnv,
    'caches',
    'project-skill-installs',
    'locks',
    ...(params.installPathSegments ?? []),
    toSkillSlug(source) || 'source'
  )

  const installed = await withInstallLock(lockDir, async () => {
    const installResult = looksLikeNpmPackageSource(source)
      ? await installNpmPackageSkillsToTemp({
        config: params.config,
        registry: params.registry,
        source,
        version: params.version
      })
      : await installSkillsCliSourceToTemp({
        cacheCwd: params.workspaceFolder,
        config: params.config,
        registry: params.registry,
        source,
        version: params.version
      })

    try {
      const normalizedSkills = installResult.installedSkills
        .map((skill) => {
          const include = resolveCollectionInclude(params.include, skill)
          if (include == null) return undefined
          return {
            installedSkill: skill,
            normalized: buildCollectionNormalizedSkill({
              include,
              registry: params.registry,
              skill,
              source,
              version: params.version
            })
          }
        })
        .filter((value): value is NonNullable<typeof value> => value != null)

      if (normalizedSkills.length === 0) {
        throw new Error(`No skills matched the configured include list for source ${source}.`)
      }

      const seenTargets = new Set<string>()
      for (const item of normalizedSkills) {
        if (item.normalized.targetDirName === '') {
          throw new Error(`Invalid local skill name "${item.normalized.targetName}".`)
        }
        if (seenTargets.has(item.normalized.targetDirName)) {
          throw new Error(`Duplicate local skill target "${item.normalized.targetName}" from source ${source}.`)
        }
        seenTargets.add(item.normalized.targetDirName)
      }

      const installed = []
      for (const item of normalizedSkills) {
        const installDir = resolveProjectOoPath(
          params.workspaceFolder,
          projectEnv,
          'skills',
          ...(params.installPathSegments ?? []),
          item.normalized.targetDirName
        )
        const skillPath = join(installDir, 'SKILL.md')
        const expectedHash = params.expectedHashes?.[item.normalized.targetDirName]

        if (params.force !== true && await pathExists(skillPath)) {
          await assertSkillDirectoryUnchanged({
            expectedHash,
            installDir
          })
          installed.push({
            ...buildInstalledSkillResult({
              hash: await computeSkillDirectoryHash(installDir),
              installDir,
              normalized: item.normalized
            }),
            normalized: item.normalized
          })
          continue
        }

        await assertSkillDirectoryUnchanged({
          expectedHash,
          installDir
        })

        const tempInstallDir = resolveProjectOoPath(
          params.workspaceFolder,
          projectEnv,
          'caches',
          'project-skill-installs',
          `${
            toTempInstallPrefix(params.installPathSegments, item.normalized.targetDirName)
          }.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`
        )

        await rm(tempInstallDir, { recursive: true, force: true })
        await mkdir(dirname(tempInstallDir), { recursive: true })
        await mkdir(tempInstallDir, { recursive: true })
        await copyRegularFiles(item.installedSkill.sourcePath, tempInstallDir)

        const tempSkillPath = join(tempInstallDir, 'SKILL.md')
        if (!await pathExists(tempSkillPath)) {
          throw new Error(`Configured skill ${item.normalized.ref} did not include SKILL.md`)
        }
        await rewriteInstalledSkillName(tempSkillPath, item.normalized.targetName)

        await rm(installDir, { recursive: true, force: true })
        await mkdir(dirname(installDir), { recursive: true })
        await rename(tempInstallDir, installDir)

        installed.push({
          ...buildInstalledSkillResult({
            hash: await computeSkillDirectoryHash(installDir),
            installDir,
            normalized: item.normalized
          }),
          normalized: item.normalized
        })
      }

      return installed
    } finally {
      await rm(installResult.tempDir, { recursive: true, force: true })
    }
  })

  await removeLegacyProjectHomeSegmentPath(
    params.workspaceFolder,
    projectEnv,
    'caches',
    'project-skill-installs',
    'locks',
    ...(params.installPathSegments ?? []),
    toSkillSlug(source) || 'source'
  )
  return installed
}

export const removeProjectSkill = async (params: {
  dirName: string
  env?: NodeJS.ProcessEnv
  workspaceFolder: string
}) => {
  const installDir = resolveProjectOoPath(params.workspaceFolder, params.env ?? process.env, 'skills', params.dirName)
  await rm(installDir, { recursive: true, force: true })
  return {
    dirName: params.dirName,
    installDir
  }
}

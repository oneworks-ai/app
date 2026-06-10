import { readFile, readdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import process from 'node:process'

import { resolveProjectOoPath } from '../ai-path'
import { readProjectSkillsLockfile } from './lockfile'
import { parseSkillFrontmatterValue } from './shared'
import type { ProjectSkillSummary } from './types'

const readSkillSummary = async (params: {
  dirName: string
  fallbackName: string
  skillPath: string
}): Promise<ProjectSkillSummary | undefined> => {
  try {
    const body = await readFile(params.skillPath, 'utf8')
    const description = parseSkillFrontmatterValue(body, 'description')
    return {
      dirName: params.dirName,
      name: parseSkillFrontmatterValue(body, 'name') ?? params.fallbackName,
      skillPath: params.skillPath,
      ...(description == null ? {} : { description })
    }
  } catch {
    return undefined
  }
}

export const readProjectSkills = async (workspaceFolder: string): Promise<ProjectSkillSummary[]> => {
  const skillsDir = resolveProjectOoPath(workspaceFolder, process.env, 'skills')
  const bySkillPath = new Map<string, ProjectSkillSummary>()

  try {
    const entries = await readdir(skillsDir, { withFileTypes: true })
    const rootSkills = await Promise.all(
      entries
        .filter(entry => entry.isDirectory() && !entry.name.startsWith('.'))
        .map(entry =>
          readSkillSummary({
            dirName: entry.name,
            fallbackName: entry.name,
            skillPath: join(skillsDir, entry.name, 'SKILL.md')
          })
        )
    )

    for (const skill of rootSkills) {
      if (skill?.skillPath == null) continue
      bySkillPath.set(skill.skillPath, skill)
    }
  } catch {}

  const lockfile = await readProjectSkillsLockfile(workspaceFolder)
  const lockedSkills = await Promise.all(
    Object.entries(lockfile.skills ?? {}).map(([key, entry]) => {
      const dirName = key.split('/').filter(Boolean).at(-1) ?? key
      return readSkillSummary({
        dirName,
        fallbackName: entry.name ?? dirName,
        skillPath: resolve(workspaceFolder, entry.installPath, 'SKILL.md')
      })
    })
  )

  for (const skill of lockedSkills) {
    if (skill?.skillPath == null) continue
    bySkillPath.set(skill.skillPath, skill)
  }

  return Array.from(bySkillPath.values())
}

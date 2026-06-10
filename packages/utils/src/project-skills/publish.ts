import { lstat, readFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import process from 'node:process'

import { resolveProjectOoPath } from '../ai-path'
import { toSkillSlug } from '../skills-cli'
import { readProjectSkills } from './read'
import { normalizeNonEmptyString, pathExists } from './shared'
import type { ResolvedProjectSkillPublishSpec } from './types'

const isRemotePublishSpec = (value: string) => (
  /^(?:https?|ssh):\/\//.test(value) ||
  /^[^@\s]+@[^:\s]+:.+/.test(value)
)

const isPathLikePublishSpec = (value: string) => (
  value.startsWith('.') ||
  value.startsWith('~') ||
  value.startsWith('/') ||
  value.includes('\\') ||
  value.includes('/')
)

const ensurePublishableSkillPath = async (targetPath: string) => {
  const stat = await lstat(targetPath)

  if (stat.isFile()) {
    if (basename(targetPath).toLowerCase() !== 'skill.md') {
      return targetPath
    }
    return dirname(targetPath)
  }

  if (!stat.isDirectory()) {
    throw new Error(`Local skill path "${targetPath}" is not a file or directory.`)
  }

  if (!await pathExists(join(targetPath, 'SKILL.md'))) {
    throw new Error(`Local skill path "${targetPath}" does not contain SKILL.md.`)
  }

  return targetPath
}

export const readSkillPublishMetadata = async (skillDir: string) => {
  const skillPath = join(skillDir, 'SKILL.md')
  if (!await pathExists(skillPath)) return undefined

  const content = await readFile(skillPath, 'utf8')
  const lines = content.split(/\r?\n/)
  if (lines[0]?.trim() !== '---') return undefined

  const closingIndex = lines.findIndex((line, index) => index > 0 && line.trim() === '---')
  if (closingIndex <= 0) return undefined

  const frontmatter = lines.slice(1, closingIndex)
  const extractNestedFrontmatterValue = (
    parents: string[],
    key: string
  ) => {
    const normalizedParents = parents.map(parent => parent.trim())
    const stack: Array<{ indent: number; key: string }> = []

    for (const line of frontmatter) {
      const trimmed = line.trim()
      if (trimmed === '' || trimmed.startsWith('#')) continue

      const content = line.trimStart()
      const indent = line.length - content.length
      const colonIndex = content.indexOf(':')
      if (colonIndex <= 0) continue

      const currentKey = content.slice(0, colonIndex).trim()
      const rawValue = content.slice(colonIndex + 1).trim()

      while (stack.length > 0 && stack[stack.length - 1]!.indent >= indent) {
        stack.pop()
      }

      if (rawValue === '') {
        stack.push({ indent, key: currentKey })
        continue
      }

      const currentPath = [...stack.map(item => item.key), currentKey]
      if (
        currentKey === key &&
        currentPath.length === normalizedParents.length + 1 &&
        normalizedParents.every((parent, index) => currentPath[index] === parent)
      ) {
        return normalizeNonEmptyString(rawValue.replace(/^["']|["']$/g, ''))
      }
    }

    return undefined
  }

  const source = extractNestedFrontmatterValue(['metadata', 'publish'], 'source')
  const registry = extractNestedFrontmatterValue(['metadata', 'publish'], 'registry')
  const group = extractNestedFrontmatterValue(['metadata', 'publish'], 'group')
  const region = extractNestedFrontmatterValue(['metadata', 'publish'], 'region')
  const access = extractNestedFrontmatterValue(['metadata', 'publish'], 'access')

  if (source == null && registry == null && group == null && region == null && access == null) {
    return undefined
  }

  return {
    ...(source == null ? {} : { source }),
    ...(registry == null ? {} : { registry }),
    ...(group == null ? {} : { group }),
    ...(region == null ? {} : { region }),
    ...(access == null ? {} : { access })
  }
}

export const resolveProjectSkillPublishSpec = async (params: {
  selector: string
  workspaceFolder: string
}): Promise<ResolvedProjectSkillPublishSpec> => {
  const selector = normalizeNonEmptyString(params.selector)
  if (selector == null) {
    throw new Error('Skill selector is required.')
  }

  if (isRemotePublishSpec(selector)) {
    return {
      kind: 'remote',
      requested: selector,
      skillSpec: selector
    }
  }

  const explicitPath = isAbsolute(selector)
    ? selector
    : resolve(params.workspaceFolder, selector)
  if (await pathExists(explicitPath)) {
    const skillSpec = await ensurePublishableSkillPath(explicitPath)
    return {
      kind: 'path',
      requested: selector,
      skillSpec,
      publish: await readSkillPublishMetadata(skillSpec)
    }
  }

  const selectorSlug = toSkillSlug(selector)
  const projectSkills = await readProjectSkills(params.workspaceFolder)
  const matches = projectSkills.filter(skill => (
    skill.dirName === selector ||
    skill.name === selector ||
    skill.dirName === selectorSlug ||
    toSkillSlug(skill.name) === selectorSlug
  ))

  if (matches.length > 1) {
    throw new Error(
      `Multiple local skills matched "${selector}": ${matches.map(skill => skill.name).join(', ')}`
    )
  }

  const matched = matches[0]
  if (matched != null) {
    const installDir = resolveProjectOoPath(params.workspaceFolder, process.env, 'skills', matched.dirName)
    const skillSpec = await ensurePublishableSkillPath(installDir)
    return {
      kind: 'project',
      requested: selector,
      skillSpec,
      dirName: matched.dirName,
      name: matched.name,
      publish: await readSkillPublishMetadata(skillSpec)
    }
  }

  if (isPathLikePublishSpec(selector)) {
    throw new Error(`Local skill path "${explicitPath}" does not exist.`)
  }

  throw new Error(`No local skill matched "${selector}". Pass a project skill name, local path, or remote git/zip URL.`)
}

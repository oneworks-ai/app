/* eslint-disable max-lines -- native host discovery keeps shared containment checks in one security boundary. */
import { createHash } from 'node:crypto'
import { open, readFile, readdir, realpath, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'

import type {
  NativeHostPluginAssetGroup,
  NativeHostPluginAssetKind,
  NativeHostSkill,
  NativeHostSkillRoot,
  PluginDetailAssetFile
} from '@oneworks/types'

import { parseSkillFrontmatterValue } from './project-skills/shared'

const MAX_NATIVE_MANIFEST_BYTES = 1024 * 1024
const MAX_NATIVE_ICON_BYTES = 1024 * 1024
const MAX_NATIVE_ASSET_BYTES = 256 * 1024
const MAX_NATIVE_ASSET_DEPTH = 5
const MAX_NATIVE_ASSET_FILES = 200
const NATIVE_ICON_MIME_TYPES: Record<string, string> = {
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp'
}

export const resolveRealUserHome = (env: Record<string, string | null | undefined>) => {
  const configured = env.__ONEWORKS_PROJECT_REAL_HOME__?.trim()
  return path.resolve(configured == null || configured === '' ? homedir() : configured)
}

export const resolveOptionalPath = (value: string | null | undefined) => {
  const normalized = value?.trim()
  return normalized == null || normalized === '' ? undefined : path.resolve(normalized)
}

export const createNativeHostPluginId = (adapter: string, identity: string) => (
  createHash('sha256').update(`${adapter}\0${identity}`).digest('hex').slice(0, 24)
)

export const discoverNativeHostSkills = async (params: {
  adapter: string
  realHome: string
  roots: NativeHostSkillRoot[]
}) => {
  const skills = new Map<string, NativeHostSkill>()
  for (const root of params.roots) {
    for (const child of await listSafeChildDirectories(root.path)) {
      const skillPath = path.resolve(child.resolvedPath, 'SKILL.md')
      let body
      try {
        body = await readFile(skillPath, 'utf8')
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue
        throw error
      }
      const id = createNativeHostPluginId('skill', child.resolvedPath)
      if (skills.has(id)) continue
      skills.set(id, {
        adapter: params.adapter,
        body,
        id,
        name: parseSkillFrontmatterValue(body, 'name') ?? child.name,
        scope: root.scope,
        source: {
          displayPath: toHomeDisplayPath(params.realHome, child.displayPath),
          id: `${params.adapter}:${root.id}`,
          type: root.scope === 'global' ? 'adapter-home' : 'adapter-project'
        },
        ...(parseSkillFrontmatterValue(body, 'description') == null
          ? {}
          : { description: parseSkillFrontmatterValue(body, 'description') })
      })
    }
  }
  return [...skills.values()]
}

export const toHomeDisplayPath = (realHome: string, targetPath: string) => {
  const relative = path.relative(path.resolve(realHome), path.resolve(targetPath))
  if (relative === '') return '~'
  if (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)) {
    return `~/${relative.split(path.sep).join('/')}`
  }
  return path.basename(targetPath)
}

export const readSmallJsonObject = async (filePath: string): Promise<Record<string, unknown> | undefined> => {
  let fileStat
  try {
    fileStat = await stat(filePath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
  if (!fileStat.isFile()) return undefined
  if (fileStat.size > MAX_NATIVE_MANIFEST_BYTES) {
    throw new Error(`JSON file exceeds ${MAX_NATIVE_MANIFEST_BYTES} bytes.`)
  }
  const parsed = JSON.parse(await readFile(filePath, 'utf8')) as unknown
  return parsed != null && typeof parsed === 'object' && !Array.isArray(parsed)
    ? parsed as Record<string, unknown>
    : undefined
}

const isPathInside = (rootDir: string, candidate: string) => {
  const relative = path.relative(rootDir, candidate)
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
}

const NATIVE_ASSET_DIRECTORIES: Record<string, NativeHostPluginAssetKind> = {
  agents: 'agents',
  apps: 'apps',
  commands: 'commands',
  docs: 'docs',
  entities: 'entities',
  flows: 'specs',
  hooks: 'hooks',
  mcp: 'mcp',
  rules: 'rules',
  scripts: 'scripts',
  skills: 'skills',
  specs: 'specs'
}

const NATIVE_ASSET_ROOT_FILES: Record<string, NativeHostPluginAssetKind> = {
  '.app.json': 'apps',
  '.mcp.json': 'mcp',
  'hooks.json': 'hooks'
}

const SENSITIVE_NATIVE_ASSET_PATTERN = /(?:^|\/)(?:\.env(?:\.|$)|.*(?:credential|secret|token|private[-_]?key).*)/iu
const SKIPPED_NATIVE_ASSET_DIRECTORIES = new Set(['.git', 'node_modules'])

const getNativeAssetContentKind = (filePath: string): PluginDetailAssetFile['contentKind'] => {
  const extension = path.extname(filePath).toLowerCase()
  if (extension === '.md' || extension === '.markdown' || extension === '.mdx') return 'markdown'
  if (
    ['.cjs', '.css', '.html', '.js', '.json', '.jsx', '.mjs', '.sh', '.ts', '.tsx', '.txt', '.yaml', '.yml']
      .includes(extension)
  ) return 'text'
  return 'binary'
}

const readNativeAssetFile = async (
  resolvedRoot: string,
  resolvedFile: string,
  relativePath: string
): Promise<PluginDetailAssetFile | undefined> => {
  const normalizedRelativePath = relativePath.split(path.sep).join('/')
  if (!isPathInside(resolvedRoot, resolvedFile) || SENSITIVE_NATIVE_ASSET_PATTERN.test(normalizedRelativePath)) {
    return undefined
  }
  const fileStat = await stat(resolvedFile)
  if (!fileStat.isFile()) return undefined
  const contentKind = getNativeAssetContentKind(relativePath)
  let content
  if (contentKind !== 'binary') {
    const file = await open(resolvedFile, 'r')
    try {
      const buffer = new Uint8Array(Math.min(fileStat.size, MAX_NATIVE_ASSET_BYTES))
      const { bytesRead } = await file.read(buffer, 0, buffer.length, 0)
      content = new TextDecoder().decode(buffer.subarray(0, bytesRead))
    } finally {
      await file.close()
    }
  }
  return {
    ...(content == null ? {} : { content }),
    contentKind,
    path: normalizedRelativePath,
    size: fileStat.size,
    ...(content != null && fileStat.size > MAX_NATIVE_ASSET_BYTES ? { truncated: true } : {})
  }
}

const collectNativeAssetDirectory = async (params: {
  depth: number
  files: PluginDetailAssetFile[]
  relativeRoot: string
  resolvedDirectory: string
  resolvedRoot: string
}) => {
  if (params.depth > MAX_NATIVE_ASSET_DEPTH || params.files.length >= MAX_NATIVE_ASSET_FILES) return
  const entries = await readdir(params.resolvedDirectory, { withFileTypes: true })
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (params.files.length >= MAX_NATIVE_ASSET_FILES) return
    if (entry.name.startsWith('.') || SKIPPED_NATIVE_ASSET_DIRECTORIES.has(entry.name)) continue
    const candidate = path.resolve(params.resolvedDirectory, entry.name)
    let resolvedCandidate
    try {
      resolvedCandidate = await realpath(candidate)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue
      throw error
    }
    if (!isPathInside(params.resolvedRoot, resolvedCandidate)) continue
    const relativePath = path.join(params.relativeRoot, entry.name)
    const candidateStat = await stat(resolvedCandidate)
    if (candidateStat.isDirectory()) {
      await collectNativeAssetDirectory({
        ...params,
        depth: params.depth + 1,
        relativeRoot: relativePath,
        resolvedDirectory: resolvedCandidate
      })
      continue
    }
    const file = await readNativeAssetFile(params.resolvedRoot, resolvedCandidate, relativePath)
    if (file != null) params.files.push(file)
  }
}

export const listNativeHostPluginAssetsWithin = async (
  rootDir: string
): Promise<NativeHostPluginAssetGroup[]> => {
  let resolvedRoot
  try {
    resolvedRoot = await realpath(rootDir)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
  if (!(await stat(resolvedRoot)).isDirectory()) return []

  const groups = new Map<NativeHostPluginAssetKind, PluginDetailAssetFile[]>()
  const rootEntries = await readdir(resolvedRoot, { withFileTypes: true })
  for (const entry of rootEntries.sort((left, right) => left.name.localeCompare(right.name))) {
    const directoryKind = NATIVE_ASSET_DIRECTORIES[entry.name.toLowerCase()]
    const rootFileKind = NATIVE_ASSET_ROOT_FILES[entry.name.toLowerCase()]
    if (directoryKind == null && rootFileKind == null) continue
    const candidate = path.resolve(resolvedRoot, entry.name)
    const resolvedCandidate = await realpath(candidate)
    if (!isPathInside(resolvedRoot, resolvedCandidate)) continue
    if (directoryKind != null && (await stat(resolvedCandidate)).isDirectory()) {
      const files = groups.get(directoryKind) ?? []
      await collectNativeAssetDirectory({
        depth: 0,
        files,
        relativeRoot: entry.name,
        resolvedDirectory: resolvedCandidate,
        resolvedRoot
      })
      groups.set(directoryKind, files)
      continue
    }
    if (rootFileKind != null) {
      const file = await readNativeAssetFile(resolvedRoot, resolvedCandidate, entry.name)
      if (file != null) groups.set(rootFileKind, [...(groups.get(rootFileKind) ?? []), file])
    }
  }

  return [...groups.entries()]
    .filter(([, files]) => files.length > 0)
    .map(([kind, files]) => ({ kind, files }))
    .sort((left, right) => left.kind.localeCompare(right.kind))
}

export const readSmallJsonObjectWithin = async (rootDir: string, filePath: string) => {
  try {
    const [resolvedRoot, resolvedFile] = await Promise.all([realpath(rootDir), realpath(filePath)])
    if (!isPathInside(resolvedRoot, resolvedFile)) return undefined
    return await readSmallJsonObject(resolvedFile)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

export const readNativeIconDataUrlWithin = async (rootDir: string, iconPath: string | undefined) => {
  if (iconPath == null || iconPath.trim() === '') return undefined
  const extension = path.extname(iconPath).toLowerCase()
  const mimeType = NATIVE_ICON_MIME_TYPES[extension]
  if (mimeType == null) return undefined
  try {
    const [resolvedRoot, resolvedIcon] = await Promise.all([
      realpath(rootDir),
      realpath(path.resolve(rootDir, iconPath))
    ])
    if (!isPathInside(resolvedRoot, resolvedIcon)) return undefined
    const iconStat = await stat(resolvedIcon)
    if (!iconStat.isFile() || iconStat.size > MAX_NATIVE_ICON_BYTES) return undefined
    const content = await readFile(resolvedIcon)
    return `data:${mimeType};base64,${content.toString('base64')}`
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

export const listSafeChildDirectories = async (rootDir: string) => {
  let resolvedRoot
  try {
    resolvedRoot = await realpath(rootDir)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
  const entries = await readdir(rootDir, { withFileTypes: true })
  const children = []
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue
    const displayPath = path.resolve(rootDir, entry.name)
    try {
      const resolvedPath = await realpath(displayPath)
      if (!isPathInside(resolvedRoot, resolvedPath) || !(await stat(resolvedPath)).isDirectory()) continue
      children.push({ displayPath, name: entry.name, resolvedPath })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }
  return children
}

export const listSafeChildFiles = async (rootDir: string) => {
  let resolvedRoot
  try {
    resolvedRoot = await realpath(rootDir)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
  const entries = await readdir(rootDir, { withFileTypes: true })
  const children = []
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (!entry.isFile() && !entry.isSymbolicLink()) continue
    const displayPath = path.resolve(rootDir, entry.name)
    try {
      const resolvedPath = await realpath(displayPath)
      if (!isPathInside(resolvedRoot, resolvedPath) || !(await stat(resolvedPath)).isFile()) continue
      children.push({ displayPath, name: entry.name, resolvedPath })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }
  return children
}

export const listChildDirectories = async (rootDir: string) => {
  try {
    return (await readdir(rootDir, { withFileTypes: true }))
      .filter(entry => entry.isDirectory() || entry.isSymbolicLink())
      .map(entry => entry.name)
      .sort((left, right) => left.localeCompare(right))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
}

export const listChildFiles = async (rootDir: string) => {
  try {
    return (await readdir(rootDir, { withFileTypes: true }))
      .filter(entry => entry.isFile() || entry.isSymbolicLink())
      .map(entry => entry.name)
      .sort((left, right) => left.localeCompare(right))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
}

export const normalizeOptionalString = (value: unknown) => (
  typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
)

export const findFirstJsonManifest = async (rootDir: string, candidates: string[]) => {
  for (const candidate of candidates) {
    const filePath = path.resolve(rootDir, candidate)
    const manifest = await readSmallJsonObject(filePath)
    if (manifest != null) return { filePath, manifest }
  }
  return undefined
}

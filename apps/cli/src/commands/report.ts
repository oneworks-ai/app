import { spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'

import { writeDiagnosticSupportBundle } from '@oneworks/diagnostics/node'
import { mergeProcessEnvWithProjectEnv, resolveProjectHomePath } from '@oneworks/utils'
import type { Command } from 'commander'

import { getCliVersion } from '../utils'

export { collectReportTargets } from './report-targets'

const pad = (value: number) => String(value).padStart(2, '0')

export const formatReportTimestamp = (date: Date) => {
  const day = [
    date.getUTCFullYear(),
    pad(date.getUTCMonth() + 1),
    pad(date.getUTCDate())
  ].join('')
  const time = [
    pad(date.getUTCHours()),
    pad(date.getUTCMinutes()),
    pad(date.getUTCSeconds())
  ].join('')

  return `${day}T${time}Z`
}

export const resolveReportArchivePath = (cwd: string, filename?: string) => {
  const baseName = filename?.trim()
    ? filename.trim()
    : `report-${formatReportTimestamp(new Date())}`

  const archiveName = baseName.endsWith('.tar.gz') || baseName.endsWith('.tgz')
    ? baseName
    : `${baseName}.tar.gz`

  return path.resolve(cwd, archiveName)
}

const assertArchivePath = (archivePath: string, sources: string[]) => {
  const resolvedArchivePath = path.resolve(archivePath)

  for (const source of sources) {
    if (
      resolvedArchivePath === source ||
      resolvedArchivePath.startsWith(`${source}${path.sep}`)
    ) {
      throw new Error(`Report archive must not be created inside ${source}.`)
    }
  }
}

const toTarPath = (value: string) => value.split(path.sep).join('/')

const isPathInside = (targetPath: string, sourcePath: string) => {
  const relativePath = path.relative(path.resolve(sourcePath), path.resolve(targetPath))
  return relativePath === '' || (
    relativePath !== '..' &&
    !relativePath.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relativePath)
  )
}

const resolveCommonArchiveRoot = (sources: string[]) => {
  const resolvedSources = sources.map(source => path.dirname(path.resolve(source)))
  const first = resolvedSources[0]
  if (first == null) return process.cwd()

  const root = path.parse(first).root
  let commonParts = first.slice(root.length).split(path.sep).filter(Boolean)

  for (const source of resolvedSources.slice(1)) {
    const parsed = path.parse(source)
    if (parsed.root !== root) return parsed.root

    const parts = source.slice(root.length).split(path.sep).filter(Boolean)
    let index = 0
    while (index < commonParts.length && commonParts[index] === parts[index]) {
      index += 1
    }
    commonParts = commonParts.slice(0, index)
  }

  return path.resolve(root, ...commonParts)
}

const collectUnsafeSymlinkArchivePaths = async (params: {
  archiveRoot: string
  allowedRoot: string
  source: string
}) => {
  const unsafePaths: string[] = []

  const visit = async (targetPath: string) => {
    const info = await fs.lstat(targetPath).catch(() => undefined)
    if (info == null) return

    if (info.isSymbolicLink()) {
      const linkTarget = await fs.readlink(targetPath).catch(() => undefined)
      if (linkTarget == null) return

      const resolvedTarget = path.isAbsolute(linkTarget)
        ? path.resolve(linkTarget)
        : path.resolve(path.dirname(targetPath), linkTarget)
      if (path.isAbsolute(linkTarget) || !isPathInside(resolvedTarget, params.allowedRoot)) {
        unsafePaths.push(toTarPath(path.relative(params.archiveRoot, targetPath)))
      }
      return
    }

    if (!info.isDirectory()) return

    const entries = await fs.readdir(targetPath).catch(() => [])
    await Promise.all(entries.map(entry => visit(path.join(targetPath, entry))))
  }

  await visit(params.source)
  return unsafePaths
}

const createTarArchive = async (cwd: string, env: NodeJS.ProcessEnv, archivePath: string, sources: string[]) => {
  const archiveRoot = resolveCommonArchiveRoot(sources)
  const archiveSources = sources.map(source => toTarPath(path.relative(archiveRoot, source)))
  const mockConfigSources = archiveSources.filter(source => (
    source === '.mock/.config' || source.endsWith('/.mock/.config') || source.includes('/.mock/.config/')
  ))
  const tarExcludes = mockConfigSources.flatMap(source => [
    `${source}/**/node_modules`,
    `${source}/**/node_modules/*`
  ])
  const projectHomeDir = resolveProjectHomePath(cwd, env)
  tarExcludes.push(
    ...(await Promise.all(sources.map(source =>
      collectUnsafeSymlinkArchivePaths({
        archiveRoot,
        allowedRoot: projectHomeDir,
        source
      })
    ))).flat()
  )

  await fs.mkdir(path.dirname(archivePath), { recursive: true })

  await new Promise<void>((resolve, reject) => {
    const child = spawn('tar', [
      '-czf',
      archivePath,
      ...tarExcludes.map(pattern => `--exclude=${pattern}`),
      '-C',
      archiveRoot,
      ...archiveSources
    ], {
      cwd: archiveRoot,
      stdio: ['ignore', 'ignore', 'pipe']
    })

    let stderr = ''

    child.stderr.on('data', (chunk) => {
      stderr += String(chunk)
    })

    child.on('error', (error) => {
      const err = error as NodeJS.ErrnoException
      if (err.code === 'ENOENT') {
        reject(new Error('Failed to create report archive: `tar` command not found.'))
        return
      }
      reject(error)
    })

    child.on('close', (code) => {
      if (code === 0) {
        resolve()
        return
      }

      const message = stderr.trim()
      reject(
        new Error(
          message
            ? `Failed to create report archive: ${message}`
            : `Failed to create report archive with exit code ${code ?? -1}.`
        )
      )
    })
  })
}

export interface RunReportCommandOptions {
  cwd?: string
  filename?: string
}

export async function runReportCommand(options: RunReportCommandOptions = {}) {
  const cwd = options.cwd ?? process.cwd()
  const env = mergeProcessEnvWithProjectEnv(undefined, { workspaceFolder: cwd })
  const archivePath = resolveReportArchivePath(cwd, options.filename)
  const stagingDirectory = await fs.mkdtemp(path.join(tmpdir(), 'oneworks-support-'))
  const bundlePath = path.join(stagingDirectory, 'support-bundle.json')
  const diagnosticSources = [
    {
      directory: resolveProjectHomePath(cwd, env, 'diagnostics', 'cli'),
      label: 'cli'
    },
    {
      directory: resolveProjectHomePath(cwd, env, 'diagnostics', 'server-javascript'),
      label: 'client-javascript'
    }
  ]
  try {
    await writeDiagnosticSupportBundle({
      architecture: process.arch,
      destinationPath: bundlePath,
      platform: process.platform,
      productName: 'One Works CLI',
      productVersion: getCliVersion(),
      sources: diagnosticSources
    })
    assertArchivePath(archivePath, [stagingDirectory])
    await createTarArchive(cwd, env, archivePath, [bundlePath])
  } finally {
    await fs.rm(stagingDirectory, { force: true, recursive: true })
  }

  console.log(`Privacy-safe diagnostic support bundle created: ${archivePath}`)

  return { archivePath, sources: diagnosticSources.map(source => source.directory) }
}

export function registerReportCommand(program: Command) {
  program
    .command('report [filename]')
    .description('Create a privacy-safe diagnostic support bundle without prompts, credentials or raw logs')
    .action(async (filename?: string) => {
      try {
        await runReportCommand({ filename })
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error))
        process.exit(1)
      }
    })
}

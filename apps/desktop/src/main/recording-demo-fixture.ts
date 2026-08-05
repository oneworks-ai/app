import path from 'node:path'
import process from 'node:process'

import type { CloneDestinationDirectoryList } from './workspace-git-clone'

export const desktopRecordingDemoFixtureEnv = 'ONEWORKS_DESKTOP_RECORDING_DEMO_FIXTURE'

interface DesktopRecordingDemoFixtureWorkspace {
  actualPath: string
  displayPath: string
}

export interface DesktopRecordingDemoFixture {
  directories: string[]
  home: string
  id: string
  schemaVersion: 1
  workspaces: DesktopRecordingDemoFixtureWorkspace[]
}

const normalizeDisplayPath = (value: string) => path.posix.normalize(value.trim())

const isDisplayPathInside = (candidate: string, root: string) => (
  candidate === root || candidate.startsWith(`${root}/`)
)

const requireAbsoluteDisplayPath = (value: unknown, field: string) => {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`Desktop recording demo fixture ${field} must be a non-empty path.`)
  }
  const normalized = normalizeDisplayPath(value)
  if (!path.posix.isAbsolute(normalized)) {
    throw new TypeError(`Desktop recording demo fixture ${field} must be absolute.`)
  }
  return normalized
}

const parseDesktopRecordingDemoFixture = (value: string): DesktopRecordingDemoFixture => {
  const input = JSON.parse(value) as Partial<DesktopRecordingDemoFixture>
  if (input.schemaVersion !== 1 || typeof input.id !== 'string' || input.id.trim() === '') {
    throw new TypeError('Desktop recording demo fixture metadata is invalid.')
  }

  const home = requireAbsoluteDisplayPath(input.home, 'home')
  const directories = Array.isArray(input.directories)
    ? input.directories.map((directory, index) => requireAbsoluteDisplayPath(directory, `directories[${index}]`))
    : []
  const workspaces = Array.isArray(input.workspaces)
    ? input.workspaces.map((workspace, index) => ({
      actualPath: requireAbsoluteDisplayPath(workspace?.actualPath, `workspaces[${index}].actualPath`),
      displayPath: requireAbsoluteDisplayPath(workspace?.displayPath, `workspaces[${index}].displayPath`)
    }))
    : []

  if (
    directories.some(directory => !isDisplayPathInside(directory, home)) ||
    workspaces.some(workspace => !isDisplayPathInside(workspace.displayPath, home))
  ) {
    throw new TypeError('Desktop recording demo fixture paths must stay inside its virtual home.')
  }

  return {
    directories: [...new Set([home, ...directories, ...workspaces.map(workspace => workspace.displayPath)])],
    home,
    id: input.id,
    schemaVersion: 1,
    workspaces
  }
}

export const consumeDesktopRecordingDemoFixtureEnvironment = (
  env: NodeJS.ProcessEnv
): DesktopRecordingDemoFixture | undefined => {
  const value = env[desktopRecordingDemoFixtureEnv]?.trim()
  if (value == null || value === '') return undefined
  const fixture = parseDesktopRecordingDemoFixture(value)
  delete env[desktopRecordingDemoFixtureEnv]
  return fixture
}

const processDesktopRecordingDemoFixture = consumeDesktopRecordingDemoFixtureEnvironment(process.env)

export const readDesktopRecordingDemoFixture = (
  env?: NodeJS.ProcessEnv
): DesktopRecordingDemoFixture | undefined => {
  if (env == null) return processDesktopRecordingDemoFixture
  const value = env[desktopRecordingDemoFixtureEnv]?.trim()
  return value == null || value === '' ? undefined : parseDesktopRecordingDemoFixture(value)
}

export const listDesktopRecordingDemoFixtureDirectories = (
  rawDirectory: unknown,
  env?: NodeJS.ProcessEnv
): CloneDestinationDirectoryList | undefined => {
  const fixture = readDesktopRecordingDemoFixture(env)
  if (fixture == null) return undefined

  const requestedDirectory = typeof rawDirectory === 'string' && rawDirectory.trim() !== ''
    ? normalizeDisplayPath(rawDirectory)
    : fixture.home
  const currentDirectory = isDisplayPathInside(requestedDirectory, fixture.home)
    ? requestedDirectory
    : fixture.home
  const directories = fixture.directories
    .filter(directory => directory !== currentDirectory && path.posix.dirname(directory) === currentDirectory)
    .map(directory => ({
      name: path.posix.basename(directory),
      path: directory
    }))
    .sort((left, right) => left.name.localeCompare(right.name, undefined, { numeric: true }))
  const parentDirectory = currentDirectory === fixture.home
    ? undefined
    : path.posix.dirname(currentDirectory)

  return {
    currentDirectory,
    directories,
    ...(parentDirectory == null ? {} : { parentDirectory })
  }
}

export const resolveDesktopRecordingDemoWorkspacePath = (
  workspaceFolder: string,
  env?: NodeJS.ProcessEnv
): string => {
  const fixture = readDesktopRecordingDemoFixture(env)
  if (fixture == null) return workspaceFolder
  if (workspaceFolder.trim() === '') {
    throw new TypeError('A demo workspace path is required.')
  }

  const displayPath = normalizeDisplayPath(workspaceFolder)
  const workspace = fixture.workspaces.find(candidate => candidate.displayPath === displayPath)
  if (workspace == null) {
    throw new Error(`The demo workspace is not part of fixture "${fixture.id}".`)
  }
  return workspace.actualPath
}

export const resolveDesktopRecordingDemoWorkspaceDisplayPath = (
  workspaceFolder: string,
  env?: NodeJS.ProcessEnv
): string => {
  const fixture = readDesktopRecordingDemoFixture(env)
  if (fixture == null) return workspaceFolder
  const actualPath = path.resolve(workspaceFolder)
  return fixture.workspaces.find(candidate => path.resolve(candidate.actualPath) === actualPath)?.displayPath ??
    workspaceFolder
}

export const resolveDesktopRecordingDemoWorkspacePresentation = (
  workspaceFolder: string,
  env?: NodeJS.ProcessEnv
) => {
  const displayPath = resolveDesktopRecordingDemoWorkspaceDisplayPath(workspaceFolder, env)
  return {
    description: displayPath,
    name: path.posix.basename(displayPath) || displayPath,
    workspaceFolder: displayPath
  }
}

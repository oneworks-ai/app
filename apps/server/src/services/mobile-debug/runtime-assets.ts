import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

export const SCRCPY_SERVER_VERSION = '3.3.3'

interface ScrcpyServerPathOptions {
  cwd?: string
  env?: NodeJS.ProcessEnv
  moduleDir?: string
}

export const getScrcpyServerPathCandidates = ({
  cwd = process.cwd(),
  env = process.env,
  moduleDir = __dirname
}: ScrcpyServerPathOptions = {}) => {
  const fileName = `scrcpy-server-v${SCRCPY_SERVER_VERSION}`
  const desktopAppDir = env.__ONEWORKS_DESKTOP_APP_DIR__?.trim()

  return [
    env.ONEWORKS_SCRCPY_SERVER_PATH,
    desktopAppDir == null || desktopAppDir === ''
      ? undefined
      : path.join(desktopAppDir, 'resources', 'scrcpy', fileName),
    path.join(cwd, 'resources', 'scrcpy', fileName),
    path.join(cwd, 'apps', 'desktop', 'resources', 'scrcpy', fileName),
    path.resolve(moduleDir, '..', '..', '..', 'resources', 'scrcpy', fileName),
    path.resolve(moduleDir, '..', '..', '..', '..', 'apps', 'desktop', 'resources', 'scrcpy', fileName)
  ].filter((candidate): candidate is string => candidate != null && candidate.trim() !== '')
}

export const resolveScrcpyServerPath = (options: ScrcpyServerPathOptions = {}) => {
  for (const candidate of getScrcpyServerPathCandidates(options)) {
    if (fs.existsSync(candidate)) return candidate
  }
  throw new Error(`scrcpy server v${SCRCPY_SERVER_VERSION} was not found.`)
}

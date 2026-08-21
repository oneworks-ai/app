const fs = require('node:fs')
const path = require('node:path')

const PROJECT_NODE_PATH_ENV = '__ONEWORKS_PROJECT_NODE_PATH__'

const normalizeExecutable = value => {
  const executable = typeof value === 'string' ? value.trim() : ''
  return executable === '' ? undefined : executable
}

const resolveMacOSHelperExecutable = mainExecutable => {
  const executableName = path.basename(mainExecutable)
  const contentsDir = path.resolve(path.dirname(mainExecutable), '..')
  return path.join(
    contentsDir,
    'Frameworks',
    `${executableName} Helper.app`,
    'Contents',
    'MacOS',
    `${executableName} Helper`
  )
}

const resolveMacOSHelperInfoPath = helperExecutable => (
  path.resolve(path.dirname(helperExecutable), '..', 'Info.plist')
)

const assertMacOSHeadlessRuntimeIdentity = helperExecutable => {
  const infoPath = resolveMacOSHelperInfoPath(helperExecutable)
  let info
  try {
    info = fs.readFileSync(infoPath, 'utf8')
  } catch (error) {
    throw new Error(`Packaged macOS headless runtime identity is missing: ${infoPath}`, { cause: error })
  }
  if (!/<key>\s*LSUIElement\s*<\/key>\s*<true\s*\/>/u.test(info)) {
    throw new Error(`Packaged macOS headless runtime must use an LSUIElement helper: ${infoPath}`)
  }
}

/**
 * Resolve the executable and environment used for background Node.js work.
 * Packaged macOS builds use Electron's signed agent Helper bundle instead of
 * the foreground application executable, while other platforms retain their
 * existing Electron-as-Node runtime.
 * @param {{
 *   fallbackExecutable?: string,
 *   isPackaged: boolean,
 *   overrideExecutable?: string,
 *   platform?: NodeJS.Platform,
 *   processExecutable?: string
 * }} options
 */
const resolveDesktopHeadlessRuntime = ({
  fallbackExecutable = process.execPath,
  isPackaged,
  overrideExecutable = undefined,
  platform = process.platform,
  processExecutable = process.execPath
}) => {
  const override = normalizeExecutable(overrideExecutable)
  if (!isPackaged) {
    const executable = override ?? fallbackExecutable
    return {
      env: executable === processExecutable ? { ELECTRON_RUN_AS_NODE: '1' } : {},
      executable
    }
  }

  if (platform === 'darwin') {
    const executable = resolveMacOSHelperExecutable(processExecutable)
    try {
      fs.accessSync(executable, fs.constants.X_OK)
    } catch (error) {
      throw new Error(`Packaged macOS headless runtime is missing or not executable: ${executable}`, {
        cause: error
      })
    }
    assertMacOSHeadlessRuntimeIdentity(executable)
    if (override != null && path.resolve(override) !== path.resolve(executable)) {
      throw new Error('Packaged macOS background work cannot override the bundled Helper runtime')
    }
    return {
      env: {
        ELECTRON_RUN_AS_NODE: '1',
        [PROJECT_NODE_PATH_ENV]: executable
      },
      executable
    }
  }

  const executable = override ?? processExecutable
  return {
    env: {
      ELECTRON_RUN_AS_NODE: '1',
      [PROJECT_NODE_PATH_ENV]: executable
    },
    executable
  }
}

module.exports = {
  PROJECT_NODE_PATH_ENV,
  assertMacOSHeadlessRuntimeIdentity,
  resolveDesktopHeadlessRuntime,
  resolveMacOSHelperExecutable,
  resolveMacOSHelperInfoPath
}

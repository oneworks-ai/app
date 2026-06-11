const { normalizeMacIconFormat } = require('./mac-icon-support.cjs')

const DEFAULT_TARGETS_BY_PLATFORM = {
  darwin: ['dmg', 'zip'],
  linux: ['AppImage', 'deb', 'tar.gz'],
  win32: ['nsis-web']
}

const SUPPORTED_TARGETS_BY_PLATFORM = {
  darwin: new Set(['dmg', 'pkg', 'zip']),
  linux: new Set(['AppImage', 'deb', 'tar.gz']),
  win32: new Set(['dir', 'nsis-web'])
}

const splitTargetList = value =>
  value
    .split(',')
    .map(item => item.trim())
    .filter(Boolean)

const dedupeTargets = targets => [...new Set(targets)]

const parseMakeCliOptions = ({ args, printUsage }) => {
  const targets = []
  let macIconFormat

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === '--help' || arg === '-h') {
      printUsage()
      process.exit(0)
    }

    if (arg === '--target' || arg === '--targets' || arg === '-t') {
      const value = args[index + 1]
      if (value == null || value.trim() === '') {
        throw new Error(`${arg} requires a target value`)
      }
      targets.push(...splitTargetList(value))
      index += 1
      continue
    }

    if (arg.startsWith('--target=') || arg.startsWith('--targets=')) {
      targets.push(...splitTargetList(arg.slice(arg.indexOf('=') + 1)))
      continue
    }

    if (arg === '--mac-icon') {
      const value = args[index + 1]
      if (value == null || value.trim() === '') {
        throw new Error(`${arg} requires auto, icns, or icon`)
      }
      macIconFormat = normalizeMacIconFormat(value)
      index += 1
      continue
    }

    if (arg.startsWith('--mac-icon=')) {
      macIconFormat = normalizeMacIconFormat(arg.slice(arg.indexOf('=') + 1))
      continue
    }

    if (arg.startsWith('-')) {
      throw new Error(`Unsupported make option: ${arg}`)
    }

    targets.push(...splitTargetList(arg))
  }

  return {
    macIconFormat,
    targets: dedupeTargets(targets)
  }
}

const resolvePlatformTargets = ({ envTargets, platform, requestedTargets }) => {
  const targetDefaults = DEFAULT_TARGETS_BY_PLATFORM[platform]
  const supportedTargets = SUPPORTED_TARGETS_BY_PLATFORM[platform]
  if (targetDefaults == null || supportedTargets == null) {
    throw new Error(`Unsupported desktop packaging platform: ${platform}`)
  }

  const fallbackTargets = dedupeTargets(splitTargetList(envTargets ?? ''))
  const targets = requestedTargets.length > 0
    ? requestedTargets
    : (fallbackTargets.length > 0 ? fallbackTargets : targetDefaults)
  for (const target of targets) {
    if (!supportedTargets.has(target)) {
      throw new Error(
        `Unsupported desktop make target "${target}" for ${platform}. Supported targets: ${
          [...supportedTargets].join(', ')
        }`
      )
    }
  }

  return targets
}

const buildTargetArgs = ({ envTargets, platform, requestedTargets }) => {
  const targets = resolvePlatformTargets({
    envTargets,
    platform,
    requestedTargets
  })

  if (platform === 'darwin') {
    return ['--mac', ...targets]
  }

  if (platform === 'win32') {
    return ['--win', ...targets]
  }

  return ['--linux', ...targets]
}

module.exports = {
  buildTargetArgs,
  parseMakeCliOptions,
  resolvePlatformTargets
}

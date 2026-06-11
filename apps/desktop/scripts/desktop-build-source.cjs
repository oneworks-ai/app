const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const { isReleaseBuild } = require('./desktop-app-metadata.cjs')

const DESKTOP_BUILD_SOURCE_FILE = 'desktop-build-source.json'

const normalizeText = value => (typeof value === 'string' ? value.trim() : '')

const firstEnvValue = (env, keys) => {
  for (const key of keys) {
    const value = normalizeText(env[key])
    if (value !== '') return value
  }
  return undefined
}

const runGit = (args, cwd) => {
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore']
  })

  if (result.error != null || result.status !== 0) {
    return undefined
  }

  const output = normalizeText(result.stdout)
  return output === '' ? undefined : output
}

const firstGitValue = ({ commands, cwd, runGitCommand }) => {
  for (const command of commands) {
    const value = runGitCommand(command, cwd)
    if (value != null && value !== 'HEAD') return value
  }
  return undefined
}

const resolveBuildTime = ({ env, now }) => {
  const requestedBuildTime = normalizeText(env.ONEWORKS_DESKTOP_BUILD_TIME)
  const buildTime = requestedBuildTime === '' ? now() : new Date(requestedBuildTime)
  if (Number.isNaN(buildTime.getTime())) {
    throw new TypeError(`Invalid ONEWORKS_DESKTOP_BUILD_TIME: ${requestedBuildTime}`)
  }
  return buildTime.toISOString()
}

const resolveDesktopBuildSource = ({
  cwd = process.cwd(),
  env = process.env,
  now = () => new Date(),
  runGitCommand = runGit
} = {}) => {
  if (isReleaseBuild(env)) {
    return undefined
  }

  return {
    branch: firstEnvValue(env, [
      'ONEWORKS_DESKTOP_BUILD_GIT_BRANCH',
      'GITHUB_HEAD_REF',
      'GITHUB_REF_NAME'
    ]) ?? firstGitValue({
      commands: [
        ['branch', '--show-current'],
        ['rev-parse', '--abbrev-ref', 'HEAD']
      ],
      cwd,
      runGitCommand
    }) ?? 'unknown',
    buildTime: resolveBuildTime({ env, now }),
    gitHash: firstEnvValue(env, [
      'ONEWORKS_DESKTOP_BUILD_GIT_HASH',
      'GITHUB_SHA'
    ]) ?? runGitCommand(['rev-parse', 'HEAD'], cwd) ?? 'unknown'
  }
}

const writeDesktopBuildSourceFile = ({
  cwd,
  env = process.env,
  now,
  outputPath,
  runGitCommand
}) => {
  fs.rmSync(outputPath, { force: true })

  const buildSource = resolveDesktopBuildSource({
    cwd,
    env,
    now,
    runGitCommand
  })
  if (buildSource == null) {
    return undefined
  }

  fs.mkdirSync(path.dirname(outputPath), { recursive: true })
  fs.writeFileSync(outputPath, `${JSON.stringify(buildSource, null, 2)}\n`)
  return buildSource
}

module.exports = {
  DESKTOP_BUILD_SOURCE_FILE,
  resolveDesktopBuildSource,
  writeDesktopBuildSourceFile
}

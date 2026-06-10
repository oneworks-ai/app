const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const defaultXcodeDeveloperDir = '/Applications/Xcode.app/Contents/Developer'

const compareVersion = (left, right) => {
  const leftParts = left.split('.').map(value => Number.parseInt(value, 10) || 0)
  const rightParts = right.split('.').map(value => Number.parseInt(value, 10) || 0)
  for (let index = 0; index < Math.max(leftParts.length, rightParts.length); index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0)
    if (difference !== 0) return difference
  }
  return 0
}

const extractActoolVersion = output => (
  output.match(/short-bundle-version[\s\S]*?<string>([^<]+)<\/string>/)?.[1] ??
    output.match(/\b([0-9]+(?:\.[0-9]+){1,2})\b/)?.[1]
)

const formatActoolFailureReason = ({ label, output, status }) => {
  if (/license agreements?|xcodebuild -license/i.test(output)) {
    return `${label}: Xcode license has not been accepted; run \`sudo xcodebuild -license\` and \`sudo xcodebuild -runFirstLaunch\``
  }
  if (/runFirstLaunch/i.test(output)) {
    return `${label}: Xcode first-launch tasks are incomplete; run \`sudo xcodebuild -runFirstLaunch\``
  }
  if (/CommandLineTools/i.test(output)) {
    return `${label}: active developer directory is Command Line Tools; set \`DEVELOPER_DIR=${defaultXcodeDeveloperDir}\` or select full Xcode 26+`
  }
  if (output.trim()) {
    return `${label}: actool failed with exit code ${status}: ${output.trim()}`
  }
  return `${label}: actool failed with exit code ${status}`
}

const actoolChecks = () => {
  const checks = [
    {
      env: {},
      label: process.env.DEVELOPER_DIR
        ? `DEVELOPER_DIR=${process.env.DEVELOPER_DIR}`
        : 'selected developer directory'
    }
  ]

  if (!process.env.DEVELOPER_DIR && fs.existsSync(defaultXcodeDeveloperDir)) {
    checks.push({
      developerDir: defaultXcodeDeveloperDir,
      env: {
        DEVELOPER_DIR: defaultXcodeDeveloperDir
      },
      label: defaultXcodeDeveloperDir
    })
  }

  return checks
}

const inspectIconComposerSupport = (iconComposerPath) => {
  if (!fs.existsSync(iconComposerPath)) {
    return {
      reason: `${iconComposerPath} does not exist; run \`pnpm desktop:icons:sync\` first`,
      supported: false
    }
  }

  const failures = []
  for (const check of actoolChecks()) {
    const result = spawnSync('xcrun', ['actool', '--version'], {
      encoding: 'utf8',
      env: {
        ...process.env,
        ...check.env
      },
      stdio: 'pipe'
    })
    const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`

    if (result.error != null || result.status !== 0) {
      failures.push(formatActoolFailureReason({
        label: check.label,
        output,
        status: result.status ?? 'unknown'
      }))
      continue
    }

    const version = extractActoolVersion(output)
    if (version == null) {
      failures.push(`${check.label}: unable to read actool version; Xcode 26 or newer is required`)
      continue
    }

    if (compareVersion(version, '26.0.0') < 0) {
      failures.push(`${check.label}: actool ${version} is older than 26.0.0`)
      continue
    }

    return {
      developerDir: check.developerDir,
      supported: true,
      version
    }
  }

  return {
    reason: failures.join('; ') || 'Xcode actool is unavailable; Xcode 26 or newer is required',
    supported: false
  }
}

const applyIconComposerDeveloperDir = (support) => {
  if (!support.supported || !support.developerDir || process.env.DEVELOPER_DIR) return
  process.env.DEVELOPER_DIR = path.resolve(support.developerDir)
  console.log(`[desktop] using Xcode developer directory ${process.env.DEVELOPER_DIR}`)
}

module.exports = {
  applyIconComposerDeveloperDir,
  inspectIconComposerSupport
}

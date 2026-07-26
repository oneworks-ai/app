const fs = require('node:fs')
const path = require('node:path')

const DESKTOP_VERSION_PATTERN = /^[0-9]+\.[0-9]+\.[0-9]+([-.][0-9A-Za-z.-]+)?$/

const resolveDesktopPackageVersion = ({ env = process.env, fallbackVersion } = {}) => {
  const requestedVersion = env.ONEWORKS_DESKTOP_VERSION?.trim()
  const version = requestedVersion || fallbackVersion
  if (typeof version !== 'string' || !DESKTOP_VERSION_PATTERN.test(version)) {
    throw new Error(`Invalid desktop app version: ${version}`)
  }
  return version
}

const stampDesktopPackageVersion = (stagingDir, version) => {
  if (!DESKTOP_VERSION_PATTERN.test(version)) {
    throw new Error(`Invalid desktop app version: ${version}`)
  }

  const manifestPath = path.join(stagingDir, 'package.json')
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  manifest.version = version
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
  return manifestPath
}

module.exports = {
  resolveDesktopPackageVersion,
  stampDesktopPackageVersion
}

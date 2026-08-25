#!/usr/bin/env node
/* Dependency-free, conservative release-tag fast-path classifier. */
const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const process = require('node:process')
const { isPrereleaseVersion, vscodeExtensionPackageName } = require(
  '../apps/vscode-extension/scripts/release-identity.cjs'
)

const authorityPaths = new Set([
  '.github/workflows/release-tags.yml',
  '.github/workflows/vscode-extension-release.yml',
  'scripts/release-tags-preplan.cjs',
  'scripts/release-tags-preplan.d.cts',
  'scripts/__tests__/release-tags.spec.ts',
  'scripts/__tests__/vscode-extension-release.spec.ts',
  'scripts/release-tags.ts',
  'scripts/cli-package-release.ts',
  'scripts/cli.ts',
  'scripts/run-tools.mjs',
  'scripts/workspace-dependency-bootstrap.mjs',
  'scripts/workspace-submodule-bootstrap.mjs',
  'scripts/stable-release-preflight.mjs',
  'scripts/release-security-audit.mjs',
  'scripts/publish-plan-core.mjs',
  'scripts/windows-installer-identity.cjs'
])
const manifest = /^(?:apps|packages)\/.+\/package\.json$/u
const vscodeManifest = 'apps/vscode-extension/package.json'
const isReleaseAuthorityPath = (path) => authorityPaths.has(path) || path.startsWith('apps/vscode-extension/scripts/')

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8' })
}
function jsonAt(revision, file) {
  try {
    return JSON.parse(git(['show', `${revision}:${file}`]))
  } catch {
    return null
  }
}
function validIdentity(value) {
  return value && typeof value.name === 'string' && value.name.length > 0 &&
    typeof value.version === 'string' && /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(value.version)
}
function changed(base, head) {
  return git(['diff', '--name-status', '-z', base, head]).split('\0').filter(Boolean)
}
function preplan(base, head) {
  if (!/^[0-9a-f]{40}$/iu.test(base) || !/^[0-9a-f]{40}$/iu.test(head)) {
    return { heavy: true, reason: 'invalid immutable range' }
  }
  let entries
  try {
    entries = changed(base, head)
  } catch {
    return { heavy: true, reason: 'unreadable immutable range' }
  }
  for (let i = 0; i < entries.length;) {
    const status = entries[i++]
    if (!/^[ACDMRT]\d*$/u.test(status ?? '')) return { heavy: true, reason: 'malformed git name-status' }
    const paths = status[0] === 'R' || status[0] === 'C' ? [entries[i++], entries[i++]] : [entries[i++]]
    if (
      paths.some(path =>
        !path || path.split('').some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)
      )
    ) {
      return { heavy: true, reason: 'malformed git path' }
    }
    if (paths.some(isReleaseAuthorityPath)) {
      return { heavy: true, reason: 'release authority changed' }
    }
    const manifestPaths = status[0] === 'R' || status[0] === 'C' ? [paths[1]] : paths
    for (const path of manifestPaths) {
      if (!path) return { heavy: true, reason: 'malformed git name-status' }
      if (!manifest.test(path)) continue
      const beforePath = (status[0] === 'R' || status[0] === 'C') ? paths[0] : path
      const before = jsonAt(base, beforePath)
      const after = jsonAt(head, path)
      if (status[0] === 'D') continue
      if (!validIdentity(after)) return { heavy: true, reason: 'invalid manifest identity' }
      if (path === vscodeManifest && after.name === vscodeExtensionPackageName && isPrereleaseVersion(after.version)) {
        continue
      }
      if (!before || !validIdentity(before) || before.name !== after.name || before.version !== after.version) {
        return { heavy: true, reason: 'release identity changed' }
      }
    }
  }
  return { heavy: false, reason: 'no release identity or authority change' }
}
function main(argv = process.argv.slice(2)) {
  const [base, head] = argv
  const result = preplan(base, head)
  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `heavy=${result.heavy}\nreason=${result.reason}\n`)
  }
  process.stdout.write(`${JSON.stringify(result)}\n`)
  return result
}
if (require.main === module) main()
module.exports = { preplan }

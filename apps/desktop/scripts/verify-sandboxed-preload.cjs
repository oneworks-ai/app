const fs = require('node:fs')
const path = require('node:path')

const sandboxedPreloadAllowedModules = new Set([
  'electron',
  'events',
  'node:events',
  'node:timers',
  'node:url',
  'timers',
  'url'
])

const collectStaticRequires = source => {
  const modules = new Set()
  const requirePattern = /\brequire\((['"])([^'"]+)\1\)/g

  for (const match of source.matchAll(requirePattern)) {
    modules.add(match[2])
  }

  return [...modules].sort()
}

const verifySandboxedPreloadSource = source => {
  const unsupportedModules = collectStaticRequires(source).filter(
    moduleName => !sandboxedPreloadAllowedModules.has(moduleName)
  )

  if (unsupportedModules.length > 0) {
    throw new Error(
      `Sandboxed preload bundle contains unsupported external require(s): ${unsupportedModules.join(', ')}`
    )
  }

  return collectStaticRequires(source)
}

const verifySandboxedPreloadBundle = preloadPath => {
  const resolvedPreloadPath = path.resolve(preloadPath)
  return verifySandboxedPreloadSource(fs.readFileSync(resolvedPreloadPath, 'utf8'))
}

if (require.main === module) {
  const preloadPath = process.argv[2] ?? path.resolve(__dirname, '../dist/preload/index.js')
  const modules = verifySandboxedPreloadBundle(preloadPath)
  console.log(`[desktop-preload] verified sandbox-compatible requires: ${modules.join(', ') || 'none'}`)
}

module.exports = {
  collectStaticRequires,
  verifySandboxedPreloadBundle,
  verifySandboxedPreloadSource
}

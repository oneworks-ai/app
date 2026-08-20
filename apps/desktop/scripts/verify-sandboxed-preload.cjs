const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

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
  const sourceFile = ts.createSourceFile(
    'sandboxed-preload.js',
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS
  )

  if (sourceFile.parseDiagnostics.length > 0) {
    const diagnostics = sourceFile.parseDiagnostics.map(diagnostic =>
      ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')
    )
    throw new Error(`Sandboxed preload bundle could not be parsed: ${diagnostics.join('; ')}`)
  }

  const modules = new Set()
  const nonStaticRequireOffsets = []

  const visit = node => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'require'
    ) {
      const [moduleArgument] = node.arguments
      if (
        node.arguments.length !== 1 ||
        (moduleArgument != null &&
          !ts.isStringLiteral(moduleArgument) &&
          !ts.isNoSubstitutionTemplateLiteral(moduleArgument))
      ) {
        nonStaticRequireOffsets.push(node.getStart(sourceFile))
      } else if (moduleArgument != null) {
        modules.add(moduleArgument.text)
      }
    }

    ts.forEachChild(node, visit)
  }

  visit(sourceFile)

  if (nonStaticRequireOffsets.length > 0) {
    throw new Error(
      `Sandboxed preload bundle contains non-static require call(s) at offset(s): ${nonStaticRequireOffsets.join(', ')}`
    )
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

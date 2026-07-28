import { realpath } from 'node:fs/promises'
import path from 'node:path'

import type { Plugin } from 'rollup'
import { stripLiteral } from 'strip-literal'

import { validateClientSourceCss } from './client-source-css-boundary.js'
import {
  cleanModuleFilePath,
  isNodeModulesPath,
  isPathInside,
  resolveRealModuleFile,
  validateSourceAssetReference
} from './client-source-paths.js'

const STATIC_ASSET_URL_PATTERN = /\bnew\s+URL\s*\(\s*('[^']+'|"[^"]+"|`[^`]+`)\s*,\s*import\.meta\.url\s*(?:,\s*)?\)/dg

const parseStaticAssetReference = (literal: string) => {
  if (literal.startsWith('"')) {
    try {
      return JSON.parse(literal) as string
    } catch {
      return undefined
    }
  }
  const value = literal.slice(1, -1)
  if (value.includes('${') || value.includes('\\')) return undefined
  return value
}

export const createClientSourceBoundaryPlugin = ({
  pluginRoot,
  sourceRoot
}: {
  pluginRoot: string
  sourceRoot: string
}): Plugin & { enforce: 'pre' } => ({
  name: 'oneworks-client-source-boundary',
  enforce: 'pre',
  async transform(code, id) {
    const realSourceFile = await resolveRealModuleFile(id)
    if (realSourceFile == null || !isPathInside(sourceRoot, realSourceFile)) return null

    await validateClientSourceCss({
      code,
      id,
      sourceFile: realSourceFile,
      sourceRoot
    })
    for (const match of stripLiteral(code).matchAll(STATIC_ASSET_URL_PATTERN)) {
      const matchIndices = match.indices?.[0]
      const literalIndices = match.indices?.[1]
      if (matchIndices == null || literalIndices == null) continue
      if (code.slice(matchIndices[0], literalIndices[0]).includes('@vite-ignore')) continue
      const reference = parseStaticAssetReference(code.slice(literalIndices[0], literalIndices[1]))
      if (reference == null) {
        throw new Error(
          'Client source new URL assets must use a static unescaped path or an explicit "?inline" import.'
        )
      }
      await validateSourceAssetReference({
        reference,
        sourceFile: realSourceFile,
        sourceRoot
      })
    }
    return null
  },
  async resolveId(source, importer, options) {
    if (importer == null || source.startsWith('\0')) return null
    const realImporter = await resolveRealModuleFile(importer)
    if (realImporter == null || !isPathInside(sourceRoot, realImporter)) return null

    const resolved = await this.resolve(source, importer, { ...options, skipSelf: true })
    if (resolved == null || resolved.external) return resolved
    const realResolved = await resolveRealModuleFile(resolved.id)
    if (realResolved == null || isPathInside(sourceRoot, realResolved)) return resolved

    const pathLikeSpecifier = source.startsWith('.') ||
      source.startsWith('/') ||
      source.startsWith('file:')
    if (pathLikeSpecifier || isPathInside(pluginRoot, realResolved)) {
      throw new Error(
        `Client source import "${source}" resolves outside the client source root.`
      )
    }
    return resolved
  },
  async generateBundle(_options, bundle) {
    const bundledModuleFiles = new Set<string>()
    for (const output of Object.values(bundle)) {
      if (output.type !== 'chunk') continue
      for (const moduleId of Object.keys(output.modules)) {
        const filePath = cleanModuleFilePath(moduleId)
        const realModule = await resolveRealModuleFile(moduleId)
        if (realModule != null) bundledModuleFiles.add(realModule)
        if (
          filePath != null &&
          realModule != null &&
          isPathInside(pluginRoot, realModule) &&
          !isPathInside(sourceRoot, realModule) &&
          !isNodeModulesPath(filePath)
        ) {
          throw new Error(
            `Client source module "${moduleId}" resolves outside the client source root.`
          )
        }
      }
    }
    const packageManifest = await realpath(path.join(pluginRoot, 'package.json')).catch(() => undefined)
    for (const watchFile of this.getWatchFiles()) {
      const realWatchFile = await resolveRealModuleFile(watchFile)
      const isBundledDependencyManifest = realWatchFile != null &&
        path.basename(realWatchFile) === 'package.json' &&
        [...bundledModuleFiles].some(moduleFile => isPathInside(path.dirname(realWatchFile), moduleFile))
      if (
        realWatchFile != null &&
        realWatchFile !== packageManifest &&
        !isBundledDependencyManifest &&
        !bundledModuleFiles.has(realWatchFile) &&
        !isNodeModulesPath(watchFile) &&
        !isNodeModulesPath(realWatchFile) &&
        !isPathInside(sourceRoot, realWatchFile)
      ) {
        throw new Error(
          `Client source dependency "${watchFile}" resolves outside the client source root.`
        )
      }
    }
  }
})

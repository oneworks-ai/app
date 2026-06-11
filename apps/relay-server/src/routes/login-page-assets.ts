import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'

const relayServerPackageDir = process.env.__ONEWORKS_PROJECT_PACKAGE_DIR__ ?? process.cwd()
const workspaceRelayServerDir = join(process.cwd(), 'apps/relay-server')

const routeAssetCandidates = (filename: string) => [
  join(relayServerPackageDir, 'src/routes/assets', filename),
  join(relayServerPackageDir, 'dist/routes/assets', filename),
  join(workspaceRelayServerDir, 'src/routes/assets', filename),
  join(workspaceRelayServerDir, 'dist/routes/assets', filename)
]

const iconLoaderAssetCandidates = routeAssetCandidates('oneworks-icon-loader.bundle.js')

const readOptionalAsset = (assetPaths: string[]) => {
  for (const assetPath of assetPaths) {
    try {
      return readFileSync(assetPath, 'utf8')
    } catch {
      // Generated assets are bundled with the package; fallback keeps /login usable in dev.
    }
  }
  return ''
}

export const oneWorksIconLoaderScript = readOptionalAsset(iconLoaderAssetCandidates)

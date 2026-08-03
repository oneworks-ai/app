import process from 'node:process'

import { verifyVsixFile } from './verify-vsix.mjs'

const [packagePath, sourceVersion] = process.argv.slice(2)
if (!packagePath || !sourceVersion) {
  throw new Error('Usage: node verify-vsix-file.mjs <package-path> <logical-version>')
}

const identity = await verifyVsixFile(packagePath, sourceVersion)
process.stdout.write(
  `[vscode-vsix] logical=${identity.sourceVersion}, store=${identity.storeVersion}, ` +
    `prerelease=${identity.prerelease}\n`
)

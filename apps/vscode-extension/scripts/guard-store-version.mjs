import { execFileSync } from 'node:child_process'
import process from 'node:process'

import { assertVscodeStoreVersionAvailable, vscodeExtensionReleaseTagPrefix } from './release-manifest.mjs'

const [candidateTag, recoveryFlag, ...unexpectedArgs] = process.argv.slice(2)
if (
  !candidateTag ||
  unexpectedArgs.length > 0 ||
  (recoveryFlag != null && recoveryFlag !== '--recovery-evidence')
) {
  throw new Error(
    'Usage: node guard-store-version.mjs <release-tag> [--recovery-evidence]'
  )
}

const existingTags = execFileSync(
  'git',
  ['tag', '--list', `${vscodeExtensionReleaseTagPrefix}*`],
  { encoding: 'utf8' }
)
  .split('\n')
  .map(tag => tag.trim())
  .filter(Boolean)

const identity = assertVscodeStoreVersionAvailable(candidateTag, existingTags, {
  recoveryEvidence: recoveryFlag === '--recovery-evidence'
})
process.stdout.write(
  `[vscode-store-version] ${identity.tag}: logical=${identity.logicalVersion}, store=${identity.storeVersion}\n`
)

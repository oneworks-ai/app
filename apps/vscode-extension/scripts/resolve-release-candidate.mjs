import { readFile } from 'node:fs/promises'
import process from 'node:process'

import releaseIdentity from './release-identity.cjs'

const input = readArguments(process.argv.slice(2))
const release = input.releaseJson == null
  ? null
  : JSON.parse(await readFile(input.releaseJson, 'utf8'))
const action = releaseIdentity.resolvePersistedVsixCandidateAction({
  archiveFile: input.archiveFile,
  logicalVersion: input.logicalVersion,
  release,
  tag: input.tag
})

process.stdout.write(`${action}\n`)

function readArguments(args) {
  const values = new Map()
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index]
    const value = args[index + 1]
    if (!flag?.startsWith('--') || !value) {
      throw new Error(
        'Usage: resolve-release-candidate.mjs --tag <tag> --archive <file> ' +
          '--version <logical-version> [--release-json <path>]'
      )
    }
    values.set(flag, value)
  }

  const archiveFile = values.get('--archive')
  const logicalVersion = values.get('--version')
  const tag = values.get('--tag')
  if (!archiveFile || !logicalVersion || !tag) {
    throw new Error('Missing --tag, --archive, or --version.')
  }

  return {
    archiveFile,
    logicalVersion,
    releaseJson: values.get('--release-json'),
    tag
  }
}

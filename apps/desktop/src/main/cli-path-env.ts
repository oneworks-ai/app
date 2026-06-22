import path from 'node:path'
import process from 'node:process'

import { isDev } from './paths'

const PACKAGED_POSIX_CLI_PATHS = [
  '/opt/homebrew/bin',
  '/opt/homebrew/sbin',
  '/opt/homebrew/opt/node/bin',
  '/opt/homebrew/opt/node@24/bin',
  '/opt/homebrew/opt/node@22/bin',
  '/usr/local/bin',
  '/usr/local/sbin',
  '/usr/local/opt/node/bin',
  '/usr/local/opt/node@24/bin',
  '/usr/local/opt/node@22/bin'
]

export const resolvePackagedCliPathEnv = (
  env: NodeJS.ProcessEnv = process.env
): Pick<NodeJS.ProcessEnv, 'PATH'> | {} => {
  if (isDev || process.platform === 'win32') return {}

  const pathEntries = [
    ...PACKAGED_POSIX_CLI_PATHS,
    ...(env.PATH ?? '').split(path.delimiter)
  ]
    .map(entry => entry.trim())
    .filter((entry, index, entries) => entry !== '' && entries.indexOf(entry) === index)

  return { PATH: pathEntries.join(path.delimiter) }
}

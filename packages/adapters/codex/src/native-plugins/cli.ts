import { execFile } from 'node:child_process'

import { normalizeOptionalString } from '@oneworks/utils'

const MAX_CLI_OUTPUT_BYTES = 1024 * 1024
const CLI_TIMEOUT_MS = 5_000

export interface CodexCliPlugin {
  enabled: boolean
  installed: boolean
  marketplaceName?: string
  name: string
  pluginId: string
  sourcePath?: string
  version?: string
}

const parseCliOutput = (stdout: string): CodexCliPlugin[] => {
  const parsed = JSON.parse(stdout) as unknown
  if (parsed == null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Invalid result.')
  const installed = (parsed as Record<string, unknown>).installed
  if (!Array.isArray(installed)) throw new Error('Invalid installed list.')
  return installed.map((value) => {
    if (value == null || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid plugin entry.')
    const entry = value as Record<string, unknown>
    const source = entry.source
    const pluginId = normalizeOptionalString(entry.pluginId)
    const name = normalizeOptionalString(entry.name)
    if (
      pluginId == null || name == null || typeof entry.installed !== 'boolean' || typeof entry.enabled !== 'boolean'
    ) {
      throw new Error('Invalid plugin entry.')
    }
    return {
      enabled: entry.enabled,
      installed: entry.installed,
      marketplaceName: normalizeOptionalString(entry.marketplaceName),
      name,
      pluginId,
      sourcePath: source != null && typeof source === 'object' && !Array.isArray(source)
        ? normalizeOptionalString((source as Record<string, unknown>).path)
        : undefined,
      version: normalizeOptionalString(entry.version)
    }
  })
}

export const listCodexPlugins = (
  cwd: string,
  env: Record<string, string | null | undefined>,
  binaryPath: string = 'codex'
) =>
  new Promise<CodexCliPlugin[]>((resolve, reject) => {
    const commandEnv = Object.fromEntries(
      Object.entries(env).filter((entry): entry is [string, string] => typeof entry[1] === 'string')
    )
    execFile(binaryPath, ['plugin', 'list', '--json'], {
      cwd,
      encoding: 'utf8',
      env: commandEnv,
      maxBuffer: MAX_CLI_OUTPUT_BYTES,
      shell: false,
      timeout: CLI_TIMEOUT_MS,
      windowsHide: true
    }, (error, stdout) => {
      if (error != null) reject(error)
      else {
        try {
          resolve(parseCliOutput(stdout))
        } catch (parseError) {
          reject(parseError)
        }
      }
    })
  })

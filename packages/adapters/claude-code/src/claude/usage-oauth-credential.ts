import { Buffer } from 'node:buffer'
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { userInfo } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'

import type { ResolveClaudeQuotaOptions } from './usage'

const CLAUDE_CREDENTIAL_MAX_BYTES = 1_000_000

export interface ClaudeOauthCredential {
  accessToken: string
  expiresAt?: number
}

const isRecord = (value: unknown): value is Record<string, unknown> => (
  value != null && typeof value === 'object' && !Array.isArray(value)
)

const normalizeString = (value: unknown) => (
  typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
)

const normalizeNumber = (value: unknown) => (
  typeof value === 'number' && Number.isFinite(value) ? value : undefined
)

const parseCredential = (value: unknown): ClaudeOauthCredential | undefined => {
  if (!isRecord(value)) return undefined
  const oauth = isRecord(value.claudeAiOauth) ? value.claudeAiOauth : value
  const accessToken = normalizeString(oauth.accessToken) ?? normalizeString(oauth.access_token)
  if (accessToken == null) return undefined
  return {
    accessToken,
    expiresAt: normalizeNumber(oauth.expiresAt) ?? normalizeNumber(oauth.expires_at)
  }
}

const readJsonCredential = async (filePath: string) => {
  try {
    const fileStat = await stat(filePath)
    if (!fileStat.isFile() || fileStat.size > CLAUDE_CREDENTIAL_MAX_BYTES) return undefined
    const content = await readFile(filePath, 'utf8')
    if (Buffer.byteLength(content, 'utf8') > CLAUDE_CREDENTIAL_MAX_BYTES) return undefined
    return parseCredential(JSON.parse(content) as unknown)
  } catch {
    return undefined
  }
}

const readMacKeychainCredential = async (configDir: string | undefined) => {
  const account = userInfo().username
  const suffix = configDir == null
    ? ''
    : `-${createHash('sha256').update(configDir.normalize('NFC')).digest('hex').slice(0, 8)}`
  const service = `Claude Code-credentials${suffix}`
  return await new Promise<ClaudeOauthCredential | undefined>((resolve) => {
    execFile(
      '/usr/bin/security',
      ['find-generic-password', '-a', account, '-w', '-s', service],
      { encoding: 'utf8', maxBuffer: CLAUDE_CREDENTIAL_MAX_BYTES, timeout: 5_000 },
      (_error, stdout) => {
        if (typeof stdout !== 'string' || stdout.trim() === '') {
          resolve(undefined)
          return
        }
        try {
          resolve(parseCredential(JSON.parse(stdout.trim()) as unknown))
        } catch {
          resolve(undefined)
        }
      }
    )
  })
}

export const readClaudeOauthCredential = async (options: ResolveClaudeQuotaOptions) => (
  process.platform === 'darwin'
    ? await readMacKeychainCredential(options.configDir)
    : await readJsonCredential(join(options.configDir ?? join(options.realHome, '.claude'), '.credentials.json'))
)

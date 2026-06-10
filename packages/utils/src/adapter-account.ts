import { randomUUID } from 'node:crypto'
import { mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, relative, resolve } from 'node:path'
import process from 'node:process'

import type { AdapterAccountCredentialArtifact, AdapterCtx } from '@oneworks/types'

import { resolvePrimaryWorkspaceFolder, resolveProjectHomePath } from './ai-path'
import { migrateProjectHomeSegment, removeLegacyProjectHomeSegmentPath } from './project-home-migration'

const assertRelativeArtifactPath = (value: string) => {
  const normalized = value.trim().replace(/\\/g, '/')
  if (normalized === '' || normalized.startsWith('/')) {
    throw new Error(`Invalid adapter account artifact path "${value}".`)
  }
  if (normalized.split('/').some(segment => segment === '..' || segment === '')) {
    throw new Error(`Adapter account artifact path "${value}" must stay inside the account directory.`)
  }
  return normalized
}

export const resolveAdapterAccountsRoot = (
  cwd: string,
  env: AdapterCtx['env'],
  adapter: string
) => {
  const primaryWorkspaceFolder = resolvePrimaryWorkspaceFolder(cwd, env)
  if (primaryWorkspaceFolder != null) {
    return resolveAdapterAccountsRootForWorkspace(primaryWorkspaceFolder, env, adapter)
  }

  return resolveProjectHomePath(cwd, env, '.local', 'adapters', adapter, 'accounts')
}

const resolveAdapterAccountsRootForWorkspace = (
  workspaceFolder: string,
  env: AdapterCtx['env'],
  adapter: string
) => resolveProjectHomePath(workspaceFolder, env, '.local', 'adapters', adapter, 'accounts')

export const resolveAdapterAccountReadRoots = (
  cwd: string,
  env: AdapterCtx['env'],
  adapter: string
) => [resolve(resolveAdapterAccountsRoot(cwd, env, adapter))]

export const resolveAdapterAccountReadDirs = (
  cwd: string,
  env: AdapterCtx['env'],
  adapter: string,
  account: string
) => resolveAdapterAccountReadRoots(cwd, env, adapter).map(root => resolve(root, account))

export const resolveAdapterAccountDir = (
  cwd: string,
  env: AdapterCtx['env'],
  adapter: string,
  account: string
) => resolve(resolveAdapterAccountsRoot(cwd, env, adapter), account)

export const migrateStoredAdapterAccounts = async (
  cwd: string,
  env: AdapterCtx['env']
) => migrateProjectHomeSegment(cwd, env, '.local')

const writeFileAtomically = async (targetPath: string, content: string) => {
  await mkdir(dirname(targetPath), { recursive: true })
  const tempPath = `${targetPath}.${process.pid}.${randomUUID()}.tmp`
  try {
    await writeFile(tempPath, content, 'utf8')
    await rename(tempPath, targetPath)
  } catch (error) {
    await rm(tempPath, { force: true }).catch(() => {})
    throw error
  }
}

export const persistAdapterAccountArtifacts = async (params: {
  cwd: string
  env: AdapterCtx['env']
  adapter: string
  account: string
  artifacts: AdapterAccountCredentialArtifact[]
}) => {
  await migrateStoredAdapterAccounts(params.cwd, params.env)
  const accountDir = resolveAdapterAccountDir(params.cwd, params.env, params.adapter, params.account)

  for (const artifact of params.artifacts) {
    const relativeArtifactPath = assertRelativeArtifactPath(artifact.path)
    const targetPath = resolve(accountDir, relativeArtifactPath)
    const relativeTarget = relative(accountDir, targetPath).replace(/\\/g, '/')
    if (relativeTarget.startsWith('../') || relativeTarget === '..') {
      throw new Error(`Adapter account artifact path "${artifact.path}" resolves outside the account directory.`)
    }

    await writeFileAtomically(targetPath, artifact.content)
  }

  return {
    accountDir
  }
}

export const removeStoredAdapterAccount = async (params: {
  cwd: string
  env: AdapterCtx['env']
  adapter: string
  account: string
}) => {
  await migrateStoredAdapterAccounts(params.cwd, params.env)
  const accountDirs = resolveAdapterAccountReadDirs(params.cwd, params.env, params.adapter, params.account)
  await Promise.all([
    ...accountDirs.map(accountDir => rm(accountDir, { recursive: true, force: true })),
    removeLegacyProjectHomeSegmentPath(
      params.cwd,
      params.env,
      '.local',
      'adapters',
      params.adapter,
      'accounts',
      params.account
    )
  ])
  return {
    accountDir: accountDirs[0]
  }
}

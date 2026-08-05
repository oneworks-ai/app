import { lstat, open, readFile, rm } from 'node:fs/promises'
import path from 'node:path'

import {
  getManagedPluginConfigPath,
  readManagedPluginInstall,
  resolveManagedPluginInstallIdentity
} from '@oneworks/utils/managed-plugin'

import { inspectManagedPluginTree } from './managed-plugin-tree'
import type { ManagedPluginTreeIdentity } from './managed-plugin-tree'

const TRANSACTION_MARKER_FILE = '.oneworks-install-transaction.json'

export interface ManagedPluginInstallState {
  exists: boolean
  identity?: string
  revision: string
  rootIdentity?: ManagedPluginTreeIdentity
}

const lstatIfExists = async (target: string) =>
  lstat(target).catch((error) => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  })

export const readManagedPluginInstallState = async (
  installDir: string,
  options: { syncTree?: boolean } = {}
): Promise<ManagedPluginInstallState> => {
  const installStat = await lstatIfExists(installDir)
  if (installStat == null) return { exists: false, revision: 'absent' }
  if (!installStat.isDirectory() || installStat.isSymbolicLink()) {
    throw new Error('Managed plugin install target is not an owned directory.')
  }
  const configStat = await lstatIfExists(getManagedPluginConfigPath(installDir))
  if (configStat == null) {
    throw new Error('Managed plugin install target is not a valid managed plugin install.')
  }
  if (!configStat.isFile() || configStat.isSymbolicLink()) {
    throw new Error('Managed plugin install metadata is not an owned file.')
  }
  const initialInstall = await readManagedPluginInstall(installDir).catch(() => undefined)
  if (initialInstall == null) {
    throw new Error('Managed plugin install target is not a valid managed plugin install.')
  }
  for (const ownedDir of [initialInstall.nativePluginDir, initialInstall.oneworksPluginDir]) {
    const ownedStat = await lstatIfExists(ownedDir)
    if (ownedStat == null || !ownedStat.isDirectory() || ownedStat.isSymbolicLink()) {
      throw new Error('Managed plugin install target has invalid owned directories.')
    }
  }
  const proof = await inspectManagedPluginTree(installDir, {
    sync: options.syncTree === true
  })
  const finalInstall = await readManagedPluginInstall(installDir).catch(() => undefined)
  if (
    finalInstall == null ||
    JSON.stringify(finalInstall.config) !== JSON.stringify(initialInstall.config)
  ) {
    throw new Error('Managed plugin install metadata changed during inspection.')
  }
  return {
    exists: true,
    identity: resolveManagedPluginInstallIdentity({
      adapter: initialInstall.config.adapter,
      name: initialInstall.config.name,
      source: initialInstall.config.source
    }),
    revision: proof.digest,
    rootIdentity: proof.rootIdentity
  }
}

export const assertManagedPluginInstallIdentity = (
  state: ManagedPluginInstallState,
  identity: string
) => {
  if (state.exists && state.identity !== identity) {
    throw new Error('Managed plugin install target belongs to a different plugin.')
  }
}

interface TransactionMarker {
  identity: string
  transactionId: string
  version: 1
}

const getMarkerPath = (directory: string) => path.join(directory, TRANSACTION_MARKER_FILE)

export const writeManagedPluginTransactionMarker = async (
  directory: string,
  marker: TransactionMarker
) => {
  const handle = await open(getMarkerPath(directory), 'wx', 0o600)
  try {
    await handle.writeFile(`${JSON.stringify(marker)}\n`, 'utf8')
    await handle.sync()
  } finally {
    await handle.close()
  }
  const directoryHandle = await open(directory, 'r')
  try {
    await directoryHandle.sync()
  } finally {
    await directoryHandle.close()
  }
}

export const hasManagedPluginTransactionMarker = async (
  directory: string,
  expected: TransactionMarker
) => (await getManagedPluginTransactionMarkerStatus(directory, expected)) === 'exact'

export const getManagedPluginTransactionMarkerStatus = async (
  directory: string,
  expected: TransactionMarker
): Promise<'absent' | 'exact' | 'invalid'> => {
  const markerPath = getMarkerPath(directory)
  const markerStat = await lstatIfExists(markerPath)
  if (markerStat == null) return 'absent'
  if (!markerStat.isFile() || markerStat.isSymbolicLink()) return 'invalid'
  const marker = await readFile(markerPath, 'utf8')
    .then(value => JSON.parse(value) as Partial<TransactionMarker>)
    .catch(() => undefined)
  return (
      marker?.version === 1 &&
      marker.identity === expected.identity &&
      marker.transactionId === expected.transactionId
    )
    ? 'exact'
    : 'invalid'
}

export const removeManagedPluginTransactionMarker = async (
  directory: string
) => {
  await rm(getMarkerPath(directory), { force: true })
}

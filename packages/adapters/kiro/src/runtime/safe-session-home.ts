import { lstat, mkdtemp, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import {
  assertContained,
  assertSameDirectory,
  createDirectoryChainSafely,
  ensureContainedDirectory,
  readDirectoryIdentity
} from './safe-session-directory.js'
import type { DirectoryIdentity } from './safe-session-directory.js'

export interface KiroSessionHomeFaultInjection {
  beforeAtomicPrivateHomeCreate?: () => Promise<void> | void
}

export interface KiroCredentialBoundaryFaultInjection {
  beforeReadOnlyCredentialBoundary?: () => Promise<void> | void
}

const createAtomicPrivateSessionHome = async (faultInjection?: KiroSessionHomeFaultInjection) => {
  const systemTempRoot = await realpath(tmpdir())
  const tempIdentity = await readDirectoryIdentity(systemTempRoot, 'Kiro platform temporary root')
  await faultInjection?.beforeAtomicPrivateHomeCreate?.()
  const sessionHome = await mkdtemp(join(tempIdentity.realPath, 'oneworks-kiro-home-'))
  const sessionHomeIdentity = await readDirectoryIdentity(sessionHome, 'Kiro private session home')
  assertContained(tempIdentity.realPath, sessionHomeIdentity.realPath, 'Kiro private session home')
  const metadata = await lstat(sessionHome)
  if ((metadata.mode & 0o077) !== 0) {
    throw new Error('Kiro private session home must not grant group or other filesystem access.')
  }
  return { sessionHome, sessionHomeIdentity }
}

export interface KiroSessionLayout {
  cacheRoot: string
  cacheRootIdentity: DirectoryIdentity
  kiroHome: string
  kiroHomeIdentity: DirectoryIdentity
  sessionHome: string
  sessionHomeIdentity: DirectoryIdentity
  sessionRoot: string
  sessionRootIdentity: DirectoryIdentity
}

export const prepareSafeKiroSessionLayout = async (params: {
  cacheRoot: string
  faultInjection?: KiroSessionHomeFaultInjection
  kiroHome: string
  sessionRoot: string
}): Promise<KiroSessionLayout> => {
  const cacheRoot = resolve(params.cacheRoot)
  const sessionRoot = resolve(params.sessionRoot)
  const kiroHome = resolve(params.kiroHome)
  if (sessionRoot === cacheRoot) {
    throw new Error('Kiro managed session root must be a child of the managed cache root.')
  }
  assertContained(cacheRoot, sessionRoot, 'Kiro managed session root')
  assertContained(sessionRoot, kiroHome, 'Kiro isolated native home')

  const cacheRootIdentity = await createDirectoryChainSafely(cacheRoot, 'Kiro managed cache root')
  const sessionRootIdentity = await ensureContainedDirectory({
    label: 'Kiro managed session root',
    rootIdentity: cacheRootIdentity,
    rootPath: cacheRoot,
    targetPath: sessionRoot
  })
  const kiroHomeIdentity = await ensureContainedDirectory({
    label: 'Kiro isolated native home',
    rootIdentity: cacheRootIdentity,
    rootPath: cacheRoot,
    targetPath: kiroHome
  })
  assertContained(sessionRootIdentity.realPath, kiroHomeIdentity.realPath, 'Kiro isolated native home')

  const privateHome = await createAtomicPrivateSessionHome(params.faultInjection)
  await assertSameDirectory(cacheRoot, cacheRootIdentity, 'Kiro managed cache root')
  await assertSameDirectory(sessionRoot, sessionRootIdentity, 'Kiro managed session root')
  await assertSameDirectory(kiroHome, kiroHomeIdentity, 'Kiro isolated native home')

  return {
    cacheRoot,
    cacheRootIdentity,
    kiroHome,
    kiroHomeIdentity,
    sessionHome: privateHome.sessionHome,
    sessionHomeIdentity: privateHome.sessionHomeIdentity,
    sessionRoot,
    sessionRootIdentity
  }
}

/**
 * Node has no portable openat-style directory-relative mkdir/unlink/symlink API. Kiro therefore
 * receives a fresh private HOME and current-process credential providers only. This boundary is
 * intentionally read-only: it never creates, removes, replaces, or links a Keychain pathname.
 */
export const syncSafeKiroKeychains = async (params: {
  faultInjection?: KiroCredentialBoundaryFaultInjection
  layout: KiroSessionLayout
  platform?: NodeJS.Platform
  realHome?: string
}) => {
  await params.faultInjection?.beforeReadOnlyCredentialBoundary?.()
  await assertSameDirectory(
    params.layout.sessionHome,
    params.layout.sessionHomeIdentity,
    'Kiro private session home'
  )
  await assertSameDirectory(
    params.layout.cacheRoot,
    params.layout.cacheRootIdentity,
    'Kiro managed cache root'
  )
  await assertSameDirectory(
    params.layout.sessionRoot,
    params.layout.sessionRootIdentity,
    'Kiro managed session root'
  )
  await assertSameDirectory(
    params.layout.kiroHome,
    params.layout.kiroHomeIdentity,
    'Kiro isolated native home'
  )
  return 'process-only' as const
}

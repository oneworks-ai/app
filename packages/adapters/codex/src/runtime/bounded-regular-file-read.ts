import { TextDecoder } from 'node:util'

import { readBoundedRegularFileBeneath } from '@oneworks/utils/filesystem-authority'

export const readBoundedRegularFileNoFollow = async (params: {
  afterDirectoryOpen?: (relativePath: string) => Promise<void> | void
  beforeDirectoryOpen?: (relativePath: string) => Promise<void> | void
  beforePostOpenIdentityCheck?: () => Promise<void> | void
  canonicalParent: string
  expectedIdentity?: {
    device: number
    inode: number
    size: number
  }
  filePath: string
  maxBytes: number
}): Promise<string | undefined> => {
  const buffer = await readBoundedRegularFileBeneath({
    canonicalParent: params.canonicalParent,
    expectedIdentity: params.expectedIdentity,
    filePath: params.filePath,
    maxBytes: params.maxBytes,
    operations: {
      afterDirectoryOpen: params.afterDirectoryOpen,
      beforeDirectoryOpen: params.beforeDirectoryOpen,
      beforePostOpenIdentityCheck: params.beforePostOpenIdentityCheck
    }
  })
  if (buffer == null) return undefined
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer)
  } catch {
    return undefined
  }
}

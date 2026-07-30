import { Buffer } from 'node:buffer'

import { readBoundedRegularFileNoFollow } from '../runtime/bounded-regular-file-read'
import type { AppManifestFile } from './app-metadata-files'

const MAX_APP_MANIFEST_BYTES = 256 * 1024

export const readBoundedAppManifest = async (file: AppManifestFile) => {
  if (file.size > MAX_APP_MANIFEST_BYTES) return { oversized: true as const }
  const content = await readBoundedRegularFileNoFollow({
    canonicalParent: file.canonicalRoot,
    expectedIdentity: {
      device: file.device,
      inode: file.inode,
      size: file.size
    },
    filePath: file.path,
    maxBytes: MAX_APP_MANIFEST_BYTES
  })
  if (content == null) {
    throw new Error('Codex app metadata file changed before it could be read.')
  }
  return {
    bytes: Buffer.byteLength(content, 'utf8'),
    content,
    oversized: false as const
  }
}

import { FilesystemAuthorityError } from '@oneworks/fs-authority-native'
import type { FilesystemAuthority, FilesystemPublicationOutcome } from '@oneworks/fs-authority-native'

import { badRequest, conflict, internalServerError } from '#~/utils/http.js'

export type PublishOutcome = FilesystemPublicationOutcome

const publicationError = (error: FilesystemAuthorityError) => {
  if (error.code === 'asset_exists') return conflict('Asset path already exists', undefined, error.code)
  if (error.code === 'asset_destination_changed' || error.code === 'asset_destination_forbidden') {
    return badRequest('Asset destination changed', undefined, error.code)
  }
  return internalServerError('Data asset publishing failed', {
    cause: error,
    code: error.code,
    details: { committed: error.committed, warnings: error.warnings }
  })
}
export const safelyPublishFile = async (
  params: {
    authority: FilesystemAuthority
    authorityId: string
    basename: string
    bytes: Uint8Array
    generation: number
    parentSegments: readonly string[]
  }
): Promise<PublishOutcome> => {
  if (params.authority.id !== params.authorityId) {
    throw badRequest('Workspace authority changed', undefined, 'asset_destination_changed')
  }
  try {
    return await params.authority.publish({
      authorityId: params.authorityId,
      basename: params.basename,
      bytes: params.bytes,
      generation: params.generation,
      parentSegments: params.parentSegments
    })
  } catch (error) {
    if (error instanceof FilesystemAuthorityError) throw publicationError(error)
    throw internalServerError('Data asset publishing failed', {
      cause: error,
      code: 'asset_filesystem_authority_unavailable',
      details: { committed: false }
    })
  }
}

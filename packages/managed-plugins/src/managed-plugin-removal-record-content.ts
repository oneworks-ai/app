import { Buffer } from 'node:buffer'

export const MAX_REMOVAL_RECORD_BYTES = 64 * 1024

const MAX_STAT_NUMBER_CHARACTERS = 32
const placeholderId = '0'.repeat(64)

export const encodeRemovalRecordContent = (content: string) => {
  const encoded = Buffer.from(content)
  if (encoded.length === 0 || encoded.length > MAX_REMOVAL_RECORD_BYTES) {
    throw new Error('Managed plugin removal transaction record is invalid.')
  }
  return encoded
}

export const assertRemovalRecordCanBePublished = (record: object) => {
  encodeRemovalRecordContent(`${
    JSON.stringify({
      ...record,
      publicationId: placeholderId,
      receipt: {
        device: '0'.repeat(MAX_STAT_NUMBER_CHARACTERS),
        id: placeholderId,
        inode: '0'.repeat(MAX_STAT_NUMBER_CHARACTERS)
      }
    })
  }\n`)
}

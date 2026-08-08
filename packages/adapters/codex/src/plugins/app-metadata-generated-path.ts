import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'

import { isCredentialLikeNativeAppKey } from '@oneworks/utils'

import { isCredentialShapedValue } from './app-metadata-normalization'

const MAX_DIAGNOSTIC_PATH_BYTES = 512
const DANGEROUS_METADATA_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

export const toGeneratedAppPath = (relativePath: string) => {
  const candidate = relativePath.startsWith('apps/')
    ? relativePath.slice('apps/'.length)
    : relativePath
  const safe = Buffer.byteLength(candidate, 'utf8') <= MAX_DIAGNOSTIC_PATH_BYTES &&
    candidate.split('/').every((segment) => {
      const stem = segment.replace(/\.app\.json$/iu, '')
      return (
        /^[a-z0-9][\w.-]{0,127}$/iu.test(segment) &&
        !DANGEROUS_METADATA_KEYS.has(stem) &&
        !isCredentialLikeNativeAppKey(stem) &&
        !isCredentialShapedValue(stem)
      )
    })
  return safe
    ? candidate
    : `metadata-${createHash('sha256').update(relativePath).digest('hex').slice(0, 16)}.app.json`
}

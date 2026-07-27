import { DEFAULT_DESKTOP_UPDATE_CHANNEL, normalizeDesktopUpdateChannel } from './update-types'
import type { DesktopUpdateChannel } from './update-types'

export const parseDesktopReleaseTagChannel = (
  tagName: string,
  tagNamePrefix: string
): DesktopUpdateChannel | undefined => {
  if (!tagName.startsWith(tagNamePrefix)) return undefined
  const version = tagName.slice(tagNamePrefix.length)
  const match = /^\d+\.\d+\.\d+(?:-([\dA-Za-z]+)(?:[.-][\dA-Za-z.-]+)?)?$/u.exec(version)
  if (match == null) return undefined
  return match[1] == null
    ? DEFAULT_DESKTOP_UPDATE_CHANNEL
    : normalizeDesktopUpdateChannel(match[1])
}

export const findDesktopReleaseTagInAtomFeed = (
  feed: string,
  tagNamePrefix: string,
  updateChannel: DesktopUpdateChannel
) => {
  for (const match of feed.matchAll(/<id>([^<]+)<\/id>/gu)) {
    const entryId = match[1] ?? ''
    const prefixIndex = entryId.indexOf(tagNamePrefix)
    if (prefixIndex < 0) continue
    const tagName = entryId.slice(prefixIndex).trim()
    if (parseDesktopReleaseTagChannel(tagName, tagNamePrefix) === updateChannel) {
      return tagName
    }
  }
  return undefined
}

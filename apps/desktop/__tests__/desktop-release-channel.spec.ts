import { describe, expect, it } from 'vitest'

import { findDesktopReleaseTagInAtomFeed, parseDesktopReleaseTagChannel } from '../src/main/desktop-release-channel'

const tagPrefix = 'pkg/oneworks-desktop/v'

describe('desktop release channels', () => {
  it.each(
    [
      ['pkg/oneworks-desktop/v1.2.3', 'stable'],
      ['pkg/oneworks-desktop/v1.2.3-beta.9', 'beta'],
      ['pkg/oneworks-desktop/v1.2.3-rc.2', 'rc'],
      ['pkg/oneworks-desktop/v1.2.3-alpha.1', 'alpha'],
      ['pkg/oneworks-desktop/v1.2.3-preview.1', 'stable'],
      ['pkg/oneworks-web/v1.2.3-beta.9', undefined]
    ] as const
  )('parses %s', (tagName, expected) => {
    expect(parseDesktopReleaseTagChannel(tagName, tagPrefix)).toBe(expected)
  })

  it('finds the requested desktop channel in a GitHub releases Atom feed', () => {
    const feed = `<?xml version="1.0"?>
      <feed>
        <entry><id>tag:github.com,2008:Repository/1/pkg/oneworks-web/v1.2.3-beta.8</id></entry>
        <entry><id>tag:github.com,2008:Repository/1/pkg/oneworks-desktop/v1.2.3-beta.10</id></entry>
        <entry><id>tag:github.com,2008:Repository/1/pkg/oneworks-desktop/v1.2.3</id></entry>
      </feed>`

    expect(findDesktopReleaseTagInAtomFeed(feed, tagPrefix, 'beta'))
      .toBe('pkg/oneworks-desktop/v1.2.3-beta.10')
    expect(findDesktopReleaseTagInAtomFeed(feed, tagPrefix, 'stable'))
      .toBe('pkg/oneworks-desktop/v1.2.3')
    expect(findDesktopReleaseTagInAtomFeed(feed, tagPrefix, 'rc')).toBeUndefined()
  })
})

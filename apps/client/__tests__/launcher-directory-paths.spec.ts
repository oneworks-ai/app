import { describe, expect, it } from 'vitest'

import {
  buildDirectoryBreadcrumbs,
  buildLauncherDirectoryRoutePath,
  isLikelyAbsoluteDirectoryPath,
  normalizeDirectoryPathKey,
  normalizeStoredDirectoryPaths,
  rememberDirectoryPath
} from '#~/routes/launcher-directory-paths'

describe('launcher directory paths', () => {
  it('builds drive and UNC breadcrumbs without losing their root family or authority', () => {
    const drivePath = String.raw`C:\Users\Example\ Project `
    const uncPath = String.raw`\\server\share\team\ Project `

    expect(buildDirectoryBreadcrumbs(drivePath)).toEqual([
      { label: 'C:\\', path: 'C:\\' },
      { label: 'Users', path: String.raw`C:\Users` },
      { label: 'Example', path: String.raw`C:\Users\Example` },
      { label: ' Project ', path: drivePath }
    ])
    expect(buildDirectoryBreadcrumbs(uncPath)).toEqual([
      { label: String.raw`\\server\share`, path: String.raw`\\server\share` },
      { label: 'team', path: String.raw`\\server\share\team` },
      { label: ' Project ', path: uncPath }
    ])
  })

  it('distinguishes UNC, singly rooted, relative, drive, and POSIX identities', () => {
    const keys = [
      String.raw`\\server\share\folder`,
      String.raw`\server\share\folder`,
      String.raw`server\share\folder`,
      String.raw`C:\server\share\folder`,
      '/server/share/folder'
    ].map(normalizeDirectoryPathKey)

    expect(new Set(keys).size).toBe(keys.length)
  })

  it('treats drive-relative directories as a Windows family without conflating roots', () => {
    const driveRelative = String.raw`C:Work\Repo`
    const equivalent = 'c:work/repo'

    expect(normalizeDirectoryPathKey(driveRelative)).toBe(normalizeDirectoryPathKey(equivalent))
    expect(normalizeDirectoryPathKey(driveRelative)).not.toBe(normalizeDirectoryPathKey(String.raw`C:\Work\Repo`))
    expect(buildDirectoryBreadcrumbs(driveRelative)).toEqual([
      { label: 'C:', path: 'C:' },
      { label: 'Work', path: 'C:Work' },
      { label: 'Repo', path: driveRelative }
    ])
    expect(normalizeStoredDirectoryPaths([driveRelative, equivalent], 10)).toEqual([driveRelative])
  })

  it('keeps POSIX literal backslashes distinct in keys, breadcrumbs, and parents', () => {
    const literalBackslash = String.raw`/team/a\b`
    const nestedPath = '/team/a/b'

    expect(normalizeDirectoryPathKey(literalBackslash)).not.toBe(normalizeDirectoryPathKey(nestedPath))
    expect(buildDirectoryBreadcrumbs(literalBackslash)).toEqual([
      { label: '/', path: '/' },
      { label: 'team', path: '/team' },
      { label: String.raw`a\b`, path: literalBackslash }
    ])
    expect(normalizeStoredDirectoryPaths([literalBackslash, nestedPath], 10)).toEqual([
      literalBackslash,
      nestedPath
    ])
  })

  it('preserves raw whitespace through URL, storage, recency, and dedupe surfaces', () => {
    const rawPath = ' /workspace/ Project '
    const trimmedPath = '/workspace/ Project'

    expect(normalizeDirectoryPathKey(rawPath)).not.toBe(normalizeDirectoryPathKey(trimmedPath))
    expect(normalizeStoredDirectoryPaths([
      rawPath,
      ' /workspace// Project ',
      trimmedPath,
      '   '
    ], 10)).toEqual([rawPath, trimmedPath])
    expect(rememberDirectoryPath([trimmedPath, rawPath], ' /workspace// Project ', 10)).toEqual([
      ' /workspace// Project ',
      trimmedPath
    ])

    const routePath = buildLauncherDirectoryRoutePath('open-workspace', 'local', rawPath)
    expect(decodeURIComponent(routePath.split('/').at(-1)!)).toBe(rawPath)
  })

  it('recognizes absolute roots without trimming path identity', () => {
    expect(isLikelyAbsoluteDirectoryPath(String.raw`C:\workspace`)).toBe(true)
    expect(isLikelyAbsoluteDirectoryPath(String.raw`\\server\share`)).toBe(true)
    expect(isLikelyAbsoluteDirectoryPath(String.raw`\workspace`)).toBe(true)
    expect(isLikelyAbsoluteDirectoryPath('/workspace')).toBe(true)
    expect(isLikelyAbsoluteDirectoryPath(' /workspace')).toBe(false)
  })
})

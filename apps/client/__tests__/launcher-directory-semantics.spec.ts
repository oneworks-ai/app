import { describe, expect, it } from 'vitest'

import {
  areLauncherDirectoryPathsEquivalent,
  buildLauncherDirectoryBreadcrumbs,
  buildLauncherDirectoryRoutePath,
  isLauncherAbsoluteDirectoryPath,
  parseLauncherDirectoryPathList,
  readLauncherDirectoryRouteState,
  rememberLauncherDirectoryPath,
  resolveLauncherDirectoryCommandSemantics,
  resolveLauncherDirectoryPathInput,
  resolveLauncherDirectoryRouteReplacement
} from '#~/routes/launcher-directory-semantics'

describe('launcher directory command semantics', () => {
  it('enters a folder by default and reserves an explicit action for opening it as a project', () => {
    expect(resolveLauncherDirectoryCommandSemantics({
      mode: 'open-workspace'
    })).toEqual({
      primary: {
        icon: 'chevron_right',
        label: 'enter-directory',
        operation: 'enter-directory'
      },
      secondary: {
        icon: 'folder_open',
        label: 'open-as-project',
        operation: 'open-workspace'
      }
    })
  })

  it('keeps clone, create, and parent navigation behavior intact', () => {
    expect(resolveLauncherDirectoryCommandSemantics({
      mode: 'clone'
    })).toMatchObject({
      primary: { label: 'clone', operation: 'clone' },
      secondary: { label: 'enter-directory', operation: 'enter-directory' }
    })
    expect(resolveLauncherDirectoryCommandSemantics({
      mode: 'create-workspace'
    })).toMatchObject({
      primary: { label: 'create', operation: 'create-workspace' },
      secondary: { label: 'enter-directory', operation: 'enter-directory' }
    })
    expect(resolveLauncherDirectoryCommandSemantics({
      isBackAction: true,
      mode: 'open-workspace'
    })).toEqual({
      primary: {
        icon: 'keyboard_return',
        label: 'back',
        operation: 'enter-directory'
      }
    })
  })
})

describe('launcher directory path navigation', () => {
  it('builds clickable breadcrumb targets for Unix, drive, and UNC paths', () => {
    expect(buildLauncherDirectoryBreadcrumbs('/Users/demo/project')).toEqual([
      { label: '/', path: '/' },
      { label: 'Users', path: '/Users' },
      { label: 'demo', path: '/Users/demo' },
      { label: 'project', path: '/Users/demo/project' }
    ])
    expect(buildLauncherDirectoryBreadcrumbs('C:\\Users\\demo\\project')).toEqual([
      { label: 'C:\\', path: 'C:\\' },
      { label: 'Users', path: 'C:\\Users' },
      { label: 'demo', path: 'C:\\Users\\demo' },
      { label: 'project', path: 'C:\\Users\\demo\\project' }
    ])
    expect(buildLauncherDirectoryBreadcrumbs('\\\\server\\share\\team\\project')).toEqual([
      { label: '\\\\server\\share', path: '\\\\server\\share' },
      { label: 'team', path: '\\\\server\\share\\team' },
      { label: 'project', path: '\\\\server\\share\\team\\project' }
    ])
  })

  it('recognizes complete local and UNC paths without normalizing significant whitespace', () => {
    expect(isLauncherAbsoluteDirectoryPath('/Users/demo/project')).toBe(true)
    expect(isLauncherAbsoluteDirectoryPath('C:\\Users\\demo\\project')).toBe(true)
    expect(isLauncherAbsoluteDirectoryPath('\\\\server\\share\\project')).toBe(true)
    expect(isLauncherAbsoluteDirectoryPath('project')).toBe(false)
    expect(isLauncherAbsoluteDirectoryPath(' \\\\server\\share\\project')).toBe(false)
  })

  it('preserves whitespace inside breadcrumb labels and targets', () => {
    expect(buildLauncherDirectoryBreadcrumbs('/Users/ demo /project ')).toEqual([
      { label: '/', path: '/' },
      { label: 'Users', path: '/Users' },
      { label: ' demo ', path: '/Users/ demo ' },
      { label: 'project ', path: '/Users/ demo /project ' }
    ])
    expect(buildLauncherDirectoryBreadcrumbs('  relative folder/child  ')).toEqual([
      { label: '  relative folder', path: '  relative folder' },
      { label: 'child  ', path: '  relative folder/child  ' }
    ])
  })
})

describe('launcher directory route round trips', () => {
  it.each([
    ['/Users/demo/nested/project', 'local'],
    ['/用户/项目', 'local'],
    ['/tmp/name #?%&=+', 'local'],
    ['C:\\Users\\Demo\\project', 'local'],
    ['\\\\server\\share\\team\\project', 'local'],
    ['/Users/demo/project ', 'local'],
    ['  relative folder/child  ', 'relay:设备/alpha']
  ])('round-trips %j through a single encoded path tail', (directory, targetId) => {
    const pathname = buildLauncherDirectoryRoutePath('open-workspace', targetId, directory)

    expect(pathname).not.toContain(directory)
    expect(readLauncherDirectoryRouteState(pathname, '')).toEqual({
      directory,
      mode: 'open-workspace',
      targetId
    })
  })

  it('keeps an all-whitespace path instead of treating it as an absent route tail', () => {
    const directory = '   '
    const pathname = buildLauncherDirectoryRoutePath('open-workspace', 'local', directory)

    expect(pathname).toBe('/launcher/browse/open-workspace/local/%20%20%20')
    expect(readLauncherDirectoryRouteState(pathname, '')?.directory).toBe(directory)
  })

  it('migrates a legacy path query with replace semantics and preserves unrelated search state', () => {
    const directory = '\\\\server\\share\\ project '
    const pathname = '/launcher/browse/open-workspace/relay%3Adevice'
    const search = `?path=${encodeURIComponent(directory)}&keep=%E5%80%BC&q=old&view=commands`

    expect(readLauncherDirectoryRouteState(pathname, search)).toEqual({
      directory,
      mode: 'open-workspace',
      targetId: 'relay:device'
    })
    expect(resolveLauncherDirectoryRouteReplacement({
      directory,
      mode: 'open-workspace',
      pathname,
      search,
      targetId: 'relay:device'
    })).toEqual({
      pathname: `/launcher/browse/open-workspace/relay%3Adevice/${encodeURIComponent(directory)}`,
      replace: true,
      search: '?keep=%E5%80%BC'
    })
  })
})

describe('launcher directory production path seam', () => {
  it('rejects blank input without rewriting valid path strings passed to production handlers', () => {
    expect(resolveLauncherDirectoryPathInput(undefined)).toBeUndefined()
    expect(resolveLauncherDirectoryPathInput('')).toBeUndefined()
    expect(resolveLauncherDirectoryPathInput('   ')).toBeUndefined()

    const paths = [
      '/tmp/project ',
      ' C:\\Users\\demo\\project',
      '\\\\server\\share\\ team ',
      '/用户/项目 #?%'
    ]
    for (const path of paths) {
      expect(resolveLauncherDirectoryPathInput(path)).toBe(path)
    }
  })

  it('deduplicates equivalent paths without collapsing whitespace-significant paths', () => {
    expect(areLauncherDirectoryPathsEquivalent('/tmp/project', '/tmp/project')).toBe(true)
    expect(areLauncherDirectoryPathsEquivalent('/tmp/project/', '/tmp/project')).toBe(true)
    expect(areLauncherDirectoryPathsEquivalent('C:\\Users\\Demo', 'c:/Users/Demo')).toBe(true)
    expect(areLauncherDirectoryPathsEquivalent('/tmp/project ', '/tmp/project')).toBe(false)
    expect(areLauncherDirectoryPathsEquivalent(' /tmp/project', '/tmp/project')).toBe(false)
  })

  it('keeps UNC and rooted paths in distinct identity families', () => {
    expect(areLauncherDirectoryPathsEquivalent('\\\\server\\share\\dir', '/server/share/dir')).toBe(false)
    expect(areLauncherDirectoryPathsEquivalent('\\\\server\\share\\dir', '//server/share/dir')).toBe(true)
  })

  it('persists and reopens recent directories with their original whitespace intact', () => {
    const whitespacePath = '/tmp/project '
    const plainPath = '/tmp/project'
    const remembered = rememberLauncherDirectoryPath(
      [plainPath, whitespacePath, '/tmp/other'],
      whitespacePath,
      12
    )

    expect(remembered).toEqual([whitespacePath, plainPath, '/tmp/other'])
    expect(parseLauncherDirectoryPathList(JSON.parse(JSON.stringify(remembered)))).toEqual([
      whitespacePath,
      plainPath,
      '/tmp/other'
    ])
    expect(parseLauncherDirectoryPathList(['   ', whitespacePath, whitespacePath])).toEqual([
      whitespacePath
    ])
  })
})

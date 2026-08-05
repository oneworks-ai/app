import path from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  consumeDesktopRecordingDemoFixtureEnvironment,
  desktopRecordingDemoFixtureEnv,
  listDesktopRecordingDemoFixtureDirectories,
  readDesktopRecordingDemoFixture,
  resolveDesktopRecordingDemoWorkspaceDisplayPath,
  resolveDesktopRecordingDemoWorkspacePath,
  resolveDesktopRecordingDemoWorkspacePresentation
} from '../src/main/recording-demo-fixture'

const actualWorkspace = path.resolve('/tmp/oneworks-demo-workspace')
const fixtureEnv = {
  [desktopRecordingDemoFixtureEnv]: JSON.stringify({
    directories: [
      '/Users/oneworks/Documents',
      '/Users/oneworks/Projects',
      '/Users/oneworks/Projects/oneworks-demo'
    ],
    home: '/Users/oneworks',
    id: 'adapter-promo',
    schemaVersion: 1,
    workspaces: [{
      actualPath: actualWorkspace,
      displayPath: '/Users/oneworks/Projects/oneworks-demo'
    }]
  })
}

describe('desktop recording demo fixture', () => {
  it('keeps the directory browser inside a safe virtual home', () => {
    expect(listDesktopRecordingDemoFixtureDirectories(undefined, fixtureEnv)).toEqual({
      currentDirectory: '/Users/oneworks',
      directories: [
        { name: 'Documents', path: '/Users/oneworks/Documents' },
        { name: 'Projects', path: '/Users/oneworks/Projects' }
      ]
    })
    expect(listDesktopRecordingDemoFixtureDirectories('/Users/oneworks/Projects', fixtureEnv)).toEqual({
      currentDirectory: '/Users/oneworks/Projects',
      directories: [{
        name: 'oneworks-demo',
        path: '/Users/oneworks/Projects/oneworks-demo'
      }],
      parentDirectory: '/Users/oneworks'
    })
    expect(listDesktopRecordingDemoFixtureDirectories('/Users/private', fixtureEnv)?.currentDirectory)
      .toBe('/Users/oneworks')
  })

  it('maps only the declared virtual workspace to the real test workspace', () => {
    expect(resolveDesktopRecordingDemoWorkspacePath(
      '/Users/oneworks/Projects/oneworks-demo',
      fixtureEnv
    )).toBe(actualWorkspace)
    expect(resolveDesktopRecordingDemoWorkspaceDisplayPath(actualWorkspace, fixtureEnv))
      .toBe('/Users/oneworks/Projects/oneworks-demo')
    expect(resolveDesktopRecordingDemoWorkspacePresentation(actualWorkspace, fixtureEnv)).toEqual({
      description: '/Users/oneworks/Projects/oneworks-demo',
      name: 'oneworks-demo',
      workspaceFolder: '/Users/oneworks/Projects/oneworks-demo'
    })
    expect(() => resolveDesktopRecordingDemoWorkspacePath('/Users/yijie/private', fixtureEnv))
      .toThrow('not part of fixture')
  })

  it('consumes the raw fixture payload before child processes can inherit it', () => {
    const env = { ...fixtureEnv }
    expect(consumeDesktopRecordingDemoFixtureEnvironment(env)).toMatchObject({
      id: 'adapter-promo',
      workspaces: [{ actualPath: actualWorkspace }]
    })
    expect(env).not.toHaveProperty(desktopRecordingDemoFixtureEnv)
  })

  it('stays disabled when the recording environment is absent', () => {
    expect(readDesktopRecordingDemoFixture({})).toBeUndefined()
    expect(listDesktopRecordingDemoFixtureDirectories(undefined, {})).toBeUndefined()
    expect(resolveDesktopRecordingDemoWorkspacePath('/real/workspace', {})).toBe('/real/workspace')
    expect(resolveDesktopRecordingDemoWorkspaceDisplayPath('/real/workspace', {})).toBe('/real/workspace')
    expect(resolveDesktopRecordingDemoWorkspacePresentation('/real/workspace', {})).toEqual({
      description: '/real/workspace',
      name: 'workspace',
      workspaceFolder: '/real/workspace'
    })
  })

  it('rejects fixture paths that escape the virtual home', () => {
    expect(() =>
      readDesktopRecordingDemoFixture({
        [desktopRecordingDemoFixtureEnv]: JSON.stringify({
          directories: ['/Users/private'],
          home: '/Users/oneworks',
          id: 'unsafe',
          schemaVersion: 1,
          workspaces: []
        })
      })
    ).toThrow('must stay inside')
  })
})

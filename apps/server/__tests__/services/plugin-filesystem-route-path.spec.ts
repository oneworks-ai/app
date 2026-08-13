import path from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  readPluginRelativeFilesystemPath,
  serializePluginFilesystemPathForRoute
} from '#~/services/plugins/manifest.js'

describe('plugin filesystem route path policy', () => {
  it('keeps POSIX backslashes as filename bytes and encodes them for routes', () => {
    expect(readPluginRelativeFilesystemPath('assets\\icon.svg', path.posix)).toBe('assets\\icon.svg')
    expect(serializePluginFilesystemPathForRoute('./assets\\icon.svg', path.posix))
      .toBe('assets%5Cicon.svg')
    expect(readPluginRelativeFilesystemPath('../icon.svg', path.posix)).toBeUndefined()
  })

  it('uses Windows separators only under the Windows path family', () => {
    expect(readPluginRelativeFilesystemPath('assets\\icon.svg', path.win32)).toBe('assets\\icon.svg')
    expect(serializePluginFilesystemPathForRoute('.\\assets\\icon.svg', path.win32)).toBe('assets/icon.svg')
    expect(readPluginRelativeFilesystemPath('..\\icon.svg', path.win32)).toBeUndefined()
    expect(readPluginRelativeFilesystemPath('../icon.svg', path.win32)).toBeUndefined()
    expect(readPluginRelativeFilesystemPath('C:\\private\\icon.svg', path.win32)).toBeUndefined()
  })
})

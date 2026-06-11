import { userInfo } from 'node:os'
import process from 'node:process'

import { afterEach, describe, expect, it } from 'vitest'

import { resolveDefaultPosixShell, resolveTerminalShell } from '#~/services/terminal/shells.js'

const originalShell = process.env.SHELL

const restoreShell = () => {
  if (originalShell == null) {
    delete process.env.SHELL
    return
  }

  process.env.SHELL = originalShell
}

describe('terminal shell resolution', () => {
  afterEach(() => {
    restoreShell()
  })

  it('uses an explicit SHELL environment value for the default POSIX shell', () => {
    process.env.SHELL = '/custom/shell'

    expect(resolveDefaultPosixShell()).toBe('/custom/shell')
  })

  it('falls back to the user login shell when SHELL is not inherited', () => {
    delete process.env.SHELL

    const loginShell = userInfo().shell?.trim()
    const expectedShell = loginShell == null || loginShell === ''
      ? process.platform === 'darwin' ? '/bin/zsh' : '/bin/sh'
      : loginShell

    expect(resolveDefaultPosixShell()).toBe(expectedShell)
  })

  it('resolves default terminal sessions through the POSIX login shell', () => {
    if (process.platform === 'win32') {
      expect(resolveTerminalShell('default')).toBe(process.env.COMSPEC?.trim() || 'powershell.exe')
      return
    }

    delete process.env.SHELL

    expect(resolveTerminalShell('default')).toBe(resolveDefaultPosixShell())
  })
})

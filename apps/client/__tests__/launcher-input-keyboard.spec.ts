import { describe, expect, it } from 'vitest'

import { resolveLauncherInputKeyAction } from '#~/routes/launcher-input-keyboard'

describe('launcher search input keyboard ownership', () => {
  const createKeyState = (
    key: string,
    overrides: Partial<Parameters<typeof resolveLauncherInputKeyAction>[0]> = {}
  ): Parameters<typeof resolveLauncherInputKeyAction>[0] => ({
    canNavigateToParentDirectory: true,
    canRunActiveSecondaryAction: true,
    hasModifier: false,
    isDirectoryBrowserMode: true,
    key,
    selectionEnd: 1,
    selectionStart: 1,
    valueLength: 3,
    ...overrides
  })

  it('uses horizontal arrows for directory navigation only at the matching input boundary', () => {
    expect(resolveLauncherInputKeyAction(createKeyState('ArrowLeft', { selectionEnd: 0, selectionStart: 0 })))
      .toBe('navigate-parent-directory')
    expect(resolveLauncherInputKeyAction(createKeyState('ArrowRight', { selectionEnd: 3, selectionStart: 3 })))
      .toBe('run-active-secondary-command')
  })

  it.each(['ArrowLeft', 'ArrowRight'])('leaves %s to native text editing away from the input boundary', (key) => {
    expect(resolveLauncherInputKeyAction(createKeyState(key))).toBeUndefined()
  })

  it.each(['ArrowLeft', 'ArrowRight'])('leaves %s to native text selection when text is selected', (key) => {
    expect(resolveLauncherInputKeyAction(createKeyState(key, { selectionEnd: 2, selectionStart: 0 }))).toBeUndefined()
  })

  it.each(['ArrowLeft', 'ArrowRight'])('leaves modified %s to native text editing', (key) => {
    expect(resolveLauncherInputKeyAction(createKeyState(key, {
      hasModifier: true,
      selectionEnd: key === 'ArrowLeft' ? 0 : 3,
      selectionStart: key === 'ArrowLeft' ? 0 : 3
    }))).toBeUndefined()
  })

  it('does not claim a horizontal arrow when its directory action is unavailable', () => {
    expect(resolveLauncherInputKeyAction(createKeyState('ArrowLeft', {
      canNavigateToParentDirectory: false,
      selectionEnd: 0,
      selectionStart: 0
    }))).toBeUndefined()
    expect(resolveLauncherInputKeyAction(createKeyState('ArrowRight', {
      canRunActiveSecondaryAction: false,
      selectionEnd: 3,
      selectionStart: 3
    }))).toBeUndefined()
  })

  it.each(['ArrowLeft', 'ArrowRight'])('does not claim %s outside directory browser mode', (key) => {
    expect(resolveLauncherInputKeyAction(createKeyState(key, {
      isDirectoryBrowserMode: false,
      selectionEnd: key === 'ArrowLeft' ? 0 : 3,
      selectionStart: key === 'ArrowLeft' ? 0 : 3
    }))).toBeUndefined()
  })

  it.each(
    [
      ['ArrowDown', 'move-active-down'],
      ['ArrowUp', 'move-active-up'],
      ['Enter', 'run-active-command']
    ] as const
  )('keeps %s as a command-list action', (key, action) => {
    expect(resolveLauncherInputKeyAction(createKeyState(key))).toBe(action)
  })
})

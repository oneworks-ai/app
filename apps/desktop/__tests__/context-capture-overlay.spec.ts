import { describe, expect, it, vi } from 'vitest'
import { BrowserWindow, screen } from 'electron'

vi.mock('electron', () => ({
  BrowserWindow: vi.fn(),
  screen: {
    getCursorScreenPoint: vi.fn(),
    getDisplayNearestPoint: vi.fn()
  }
}))

const {
  createDesktopContextCaptureOverlayController,
  normalizeDesktopContextCaptureOverlayInput,
  resolveDesktopContextCaptureOverlayBounds
} = await import('../src/main/context-capture-overlay')

describe('desktop context capture overlay', () => {
  it('normalizes untrusted selection snapshots', () => {
    const normalized = normalizeDesktopContextCaptureOverlayInput({
      placement: 'above',
      snapshot: {
        cursorPoint: { x: 12, y: 34 },
        selectionRect: { height: 20, width: 140, x: 200, y: 300 },
        sourceApplication: {
          bundleId: 'com.apple.Safari',
          name: 'Safari'
        },
        text: ' Selected text '
      }
    })

    expect(normalized).toMatchObject({
      placement: 'above',
      snapshot: {
        cursorPoint: { x: 12, y: 34 },
        selectionRect: { height: 20, width: 140, x: 200, y: 300 },
        sourceApplication: {
          bundleId: 'com.apple.Safari',
          name: 'Safari'
        },
        text: ' Selected text ',
        trust: 'untrusted'
      }
    })
    expect(typeof normalized.snapshot.capturedAt).toBe('string')
  })

  it('rejects empty snapshots', () => {
    expect(() => normalizeDesktopContextCaptureOverlayInput({
      snapshot: {
        text: '   '
      }
    })).toThrow('Desktop context capture text is required.')
    expect(() => normalizeDesktopContextCaptureOverlayInput({})).toThrow(
      'A desktop context capture snapshot is required.'
    )
  })

  it('places auto overlays below text when there is room', () => {
    expect(resolveDesktopContextCaptureOverlayBounds({
      placement: 'auto',
      snapshot: {
        selectionRect: { height: 20, width: 100, x: 400, y: 300 }
      },
      workArea: { height: 900, width: 1200, x: 0, y: 0 }
    })).toEqual({
      height: 64,
      width: 520,
      x: 190,
      y: 330
    })
  })

  it('places auto overlays above text near the bottom edge', () => {
    expect(resolveDesktopContextCaptureOverlayBounds({
      placement: 'auto',
      snapshot: {
        selectionRect: { height: 24, width: 160, x: 500, y: 820 }
      },
      workArea: { height: 900, width: 1200, x: 0, y: 0 }
    })).toMatchObject({
      x: 320,
      y: 746
    })
  })

  it('clamps overlays inside the display work area', () => {
    expect(resolveDesktopContextCaptureOverlayBounds({
      placement: 'above',
      snapshot: {
        cursorPoint: { x: 20, y: 20 }
      },
      workArea: { height: 220, width: 260, x: 10, y: 10 }
    })).toEqual({
      height: 64,
      width: 236,
      x: 22,
      y: 22
    })
  })

  it('falls back to the current cursor when a provider has no bounds', async () => {
    const fakeWindow = {
      destroy: vi.fn(),
      hide: vi.fn(),
      isDestroyed: vi.fn(() => false),
      loadURL: vi.fn(async () => undefined),
      once: vi.fn(),
      setAlwaysOnTop: vi.fn(),
      setBounds: vi.fn(),
      setVisibleOnAllWorkspaces: vi.fn(),
      showInactive: vi.fn(),
      webContents: {
        setWindowOpenHandler: vi.fn()
      }
    }
    vi.mocked(BrowserWindow).mockImplementation(() => fakeWindow as never)
    vi.mocked(screen.getCursorScreenPoint).mockReturnValue({ x: 800, y: 500 })
    vi.mocked(screen.getDisplayNearestPoint).mockReturnValue({
      workArea: { height: 900, width: 1200, x: 0, y: 0 }
    } as never)

    const controller = createDesktopContextCaptureOverlayController()
    await controller.show({
      snapshot: {
        text: 'Selected text'
      }
    })

    expect(screen.getDisplayNearestPoint).toHaveBeenCalledWith({ x: 800, y: 500 })
    expect(fakeWindow.setBounds).toHaveBeenCalledWith({
      height: 64,
      width: 520,
      x: 540,
      y: 511
    })
  })
})

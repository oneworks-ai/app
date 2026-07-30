import process from 'node:process'

import { app } from 'electron'

import { createDesktopApp } from './app-runtime'
import { applyDesktopExternalCdpConfig } from './external-cdp'
import { applyDesktopRecordingThemeSource } from './theme-source'

const PACKAGE_MAIN_SMOKE_ENV = 'ONEWORKS_DESKTOP_PACKAGE_MAIN_SMOKE'
const PACKAGE_MAIN_SMOKE_MARKER = '[oneworks-desktop] packaged main smoke ready'

process.stdout.write(`[oneworks-desktop] main entry pid=${process.pid}\n`)
if (process.env[PACKAGE_MAIN_SMOKE_ENV] === '1') {
  void app.whenReady()
    .then(() => {
      process.stdout.write(`${PACKAGE_MAIN_SMOKE_MARKER}\n`, () => app.exit(0))
    })
    .catch((error: unknown) => {
      process.stderr.write(`[oneworks-desktop] packaged main smoke failed: ${String(error)}\n`)
      app.exit(1)
    })
} else {
  applyDesktopExternalCdpConfig()
  applyDesktopRecordingThemeSource()
  createDesktopApp().bootstrap()
}

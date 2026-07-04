import process from 'node:process'

import { createDesktopApp } from './app-runtime'
import { applyDesktopExternalCdpConfig } from './external-cdp'
import { applyDesktopRecordingThemeSource } from './theme-source'

process.stdout.write(`[oneworks-desktop] main entry pid=${process.pid}\n`)
applyDesktopExternalCdpConfig()
applyDesktopRecordingThemeSource()
createDesktopApp().bootstrap()

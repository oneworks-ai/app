import { join } from 'node:path'

import { writeDiagnosticSupportBundle } from '@oneworks/diagnostics/node'

export interface WriteDesktopSupportBundleOptions {
  architecture: string
  destinationPath: string
  generatedAt?: Date
  platform: string
  productName: string
  productVersion: string
  userDataDirectory: string
}

export const writeDesktopSupportBundle = async (
  options: WriteDesktopSupportBundleOptions
) =>
  await writeDiagnosticSupportBundle({
    architecture: options.architecture,
    destinationPath: options.destinationPath,
    generatedAt: options.generatedAt,
    platform: options.platform,
    productName: options.productName,
    productVersion: options.productVersion,
    sources: [
      {
        directory: join(options.userDataDirectory, 'diagnostics', 'startup'),
        label: 'desktop-startup'
      },
      {
        directory: join(options.userDataDirectory, 'diagnostics', 'javascript'),
        label: 'desktop-javascript'
      }
    ]
  })

export const formatDesktopSupportBundleFileName = (date = new Date()) => (
  `oneworks-support-${date.toISOString().replace(/[-:]/gu, '').replace(/\.\d{3}Z$/u, 'Z')}.json`
)

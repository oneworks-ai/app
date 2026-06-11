import { createRequire } from 'node:module'

import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const { iconComposerDocument } = require(
  '../scripts/icon-sync/manifests.cjs'
) as typeof import('../scripts/icon-sync/manifests.cjs')

describe('desktop Icon Composer manifest', () => {
  it('pins macOS backgrounds instead of inheriting Icon Composer system backgrounds', () => {
    const manifest = iconComposerDocument({
      darkBackgroundColor: 'srgb:0.0941,0.0314,0.0157,1',
      lightBackgroundColor: 'srgb:1,0.9451,0.9098,1'
    })

    expect(manifest.fill).toEqual({ solid: 'srgb:1,0.9451,0.9098,1' })
    expect(manifest['fill-specializations']).toEqual([
      {
        appearance: 'light',
        idiom: 'macOS',
        value: { solid: 'srgb:1,0.9451,0.9098,1' }
      },
      {
        appearance: 'dark',
        idiom: 'macOS',
        value: { solid: 'srgb:0.0941,0.0314,0.0157,1' }
      },
      {
        appearance: 'tinted',
        idiom: 'macOS',
        value: { solid: 'srgb:1,0.9451,0.9098,1' }
      }
    ])
  })

  it('turns off Icon Composer automatic layer fill for image layers', () => {
    const manifest = iconComposerDocument()
    const layer = manifest.groups[0].layers[0]

    expect(layer.fill).toBe('none')
    expect(layer['fill-specializations']).toEqual([
      {
        appearance: 'light',
        idiom: 'macOS',
        value: 'none'
      },
      {
        appearance: 'dark',
        idiom: 'macOS',
        value: 'none'
      },
      {
        appearance: 'tinted',
        idiom: 'macOS',
        value: 'none'
      }
    ])
  })
})

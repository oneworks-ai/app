import { Buffer } from 'node:buffer'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const { decodePng, writePngBuffer } = require(
  '../scripts/icon-sync/png-codec.cjs'
) as typeof import('../scripts/icon-sync/png-codec.cjs')
const { writeFilledPngs, writeFilledPngsFromImage } = require(
  '../scripts/icon-sync/png-resize.cjs'
) as typeof import('../scripts/icon-sync/png-resize.cjs')

describe('desktop icon PNG resizing', () => {
  it('does not sample pixels outside the requested crop', () => {
    const sourceSize = 4
    const pixels = Buffer.alloc(sourceSize * sourceSize * 4)

    for (let index = 0; index < pixels.length; index += 4) {
      pixels[index] = 255
      pixels[index + 1] = 255
      pixels[index + 2] = 255
      pixels[index + 3] = 32
    }

    for (const y of [1, 2]) {
      for (const x of [1, 2]) {
        const index = (y * sourceSize + x) * 4
        pixels[index] = 16
        pixels[index + 1] = 24
        pixels[index + 2] = 32
        pixels[index + 3] = 255
      }
    }

    const resized = decodePng(
      writeFilledPngsFromImage(
        {
          height: sourceSize,
          pixels,
          width: sourceSize
        },
        {
          pngSizes: [sourceSize],
          sourceContentRatio: 0.5,
          sourceIconSize: sourceSize
        }
      ).get(sourceSize)!
    )

    for (let index = 0; index < resized.pixels.length; index += 4) {
      expect(Array.from(resized.pixels.subarray(index, index + 4))).toEqual([16, 24, 32, 255])
    }
  })

  it('removes low-alpha light matte pixels from source background assets', () => {
    const sourceSize = 4
    const pixels = Buffer.alloc(sourceSize * sourceSize * 4)

    for (let index = 0; index < pixels.length; index += 4) {
      pixels[index] = 16
      pixels[index + 1] = 24
      pixels[index + 2] = 32
      pixels[index + 3] = 255
    }

    for (const index of [0, 4, 16]) {
      pixels[index] = 240
      pixels[index + 1] = 244
      pixels[index + 2] = 248
      pixels[index + 3] = 24
    }

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ow-icon-resize-'))
    const sourcePath = path.join(tempDir, 'icon.png')
    fs.writeFileSync(
      sourcePath,
      writePngBuffer({
        height: sourceSize,
        pixels,
        width: sourceSize
      })
    )

    try {
      const resized = decodePng(
        writeFilledPngs(sourcePath, {
          pngSizes: [sourceSize],
          sourceContentRatio: 1,
          sourceIconSize: sourceSize
        }).get(sourceSize)!
      )

      expect(Array.from(resized.pixels.subarray(0, 4))).toEqual([0, 0, 0, 0])
      expect(Array.from(resized.pixels.subarray(4, 8))).toEqual([0, 0, 0, 0])
      expect(Array.from(resized.pixels.subarray(16, 20))).toEqual([0, 0, 0, 0])
    } finally {
      fs.rmSync(tempDir, { force: true, recursive: true })
    }
  })
})

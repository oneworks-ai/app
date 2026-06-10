/* eslint-disable max-lines -- keeps PNG scaling and platform icon composition together for deterministic asset generation. */
const { Buffer } = require('node:buffer')
const { decodePng, readPng, writePngBuffer } = require('./png-codec.cjs')

const clamp = (value, min, max) => Math.min(max, Math.max(min, value))
const lightMatteAlphaLimit = 64
const lightMatteChannelFloor = 180

const samplePremultiplied = (image, x, y, bounds) => {
  const minX = bounds?.minX ?? 0
  const minY = bounds?.minY ?? 0
  const maxX = bounds?.maxX ?? image.width - 1
  const maxY = bounds?.maxY ?? image.height - 1
  const sourceX = clamp(x, minX, maxX)
  const sourceY = clamp(y, minY, maxY)
  const left = Math.floor(sourceX)
  const top = Math.floor(sourceY)
  const right = Math.min(image.width - 1, left + 1)
  const bottom = Math.min(image.height - 1, top + 1)
  const xWeight = sourceX - left
  const yWeight = sourceY - top
  const weights = [
    { index: (top * image.width + left) * 4, weight: (1 - xWeight) * (1 - yWeight) },
    { index: (top * image.width + right) * 4, weight: xWeight * (1 - yWeight) },
    { index: (bottom * image.width + left) * 4, weight: (1 - xWeight) * yWeight },
    { index: (bottom * image.width + right) * 4, weight: xWeight * yWeight }
  ]

  let red = 0
  let green = 0
  let blue = 0
  let alpha = 0
  for (const sample of weights) {
    const sampleAlpha = image.pixels[sample.index + 3] / 255
    alpha += sampleAlpha * sample.weight
    red += image.pixels[sample.index] * sampleAlpha * sample.weight
    green += image.pixels[sample.index + 1] * sampleAlpha * sample.weight
    blue += image.pixels[sample.index + 2] * sampleAlpha * sample.weight
  }

  if (alpha <= 0) return [0, 0, 0, 0]
  return [
    Math.round(red / alpha),
    Math.round(green / alpha),
    Math.round(blue / alpha),
    Math.round(alpha * 255)
  ]
}

const cropScaleImage = (image, { cropSize, left, outputSize, top }) => {
  const output = {
    height: outputSize,
    pixels: Buffer.alloc(outputSize * outputSize * 4),
    width: outputSize
  }
  const scale = cropSize / outputSize
  const sampleBounds = {
    maxX: left + cropSize - 1,
    maxY: top + cropSize - 1,
    minX: left,
    minY: top
  }

  for (let y = 0; y < outputSize; y += 1) {
    for (let x = 0; x < outputSize; x += 1) {
      const sourceX = left + (x + 0.5) * scale - 0.5
      const sourceY = top + (y + 0.5) * scale - 0.5
      const [red, green, blue, alpha] = samplePremultiplied(image, sourceX, sourceY, sampleBounds)
      const targetIndex = (y * outputSize + x) * 4
      output.pixels[targetIndex] = red
      output.pixels[targetIndex + 1] = green
      output.pixels[targetIndex + 2] = blue
      output.pixels[targetIndex + 3] = alpha
    }
  }

  return output
}

const filledCrop = (sourceSize, sourceContentRatio) => {
  const cropSize = Math.round(sourceSize * sourceContentRatio)
  const offset = Math.round((sourceSize - cropSize) / 2)
  return { cropSize, left: offset, top: offset }
}

const removeTransparentLightMatte = (image) => {
  let pixels

  for (let index = 0; index < image.pixels.length; index += 4) {
    const red = image.pixels[index]
    const green = image.pixels[index + 1]
    const blue = image.pixels[index + 2]
    const alpha = image.pixels[index + 3]
    if (
      alpha <= 0 ||
      alpha > lightMatteAlphaLimit ||
      red < lightMatteChannelFloor ||
      green < lightMatteChannelFloor ||
      blue < lightMatteChannelFloor
    ) {
      continue
    }

    pixels ??= Buffer.from(image.pixels)
    pixels[index] = 0
    pixels[index + 1] = 0
    pixels[index + 2] = 0
    pixels[index + 3] = 0
  }

  if (pixels == null) return image
  return {
    ...image,
    pixels
  }
}

const containsSuperellipse = (
  x,
  y,
  {
    exponent,
    radius,
    centerX,
    centerY
  }
) => {
  const normalizedX = Math.abs(x - centerX) / radius
  const normalizedY = Math.abs(y - centerY) / radius
  if (normalizedX > 1 || normalizedY > 1) return false
  return normalizedX ** exponent + normalizedY ** exponent <= 1
}

const superellipseCoverage = (x, y, options) => {
  const samplesPerAxis = 4
  let covered = 0
  for (let sampleY = 0; sampleY < samplesPerAxis; sampleY += 1) {
    for (let sampleX = 0; sampleX < samplesPerAxis; sampleX += 1) {
      if (
        containsSuperellipse(
          x + (sampleX + 0.5) / samplesPerAxis,
          y + (sampleY + 0.5) / samplesPerAxis,
          options
        )
      ) {
        covered += 1
      }
    }
  }
  return covered / (samplesPerAxis * samplesPerAxis)
}

const maskMacOsIcon = (image, {
  contentRatio,
  squircleExponent,
  outputSize
}) => {
  const contentSize = Math.round(outputSize * contentRatio)
  const offset = Math.round((outputSize - contentSize) / 2)
  const radius = contentSize / 2
  const output = {
    height: image.height,
    pixels: Buffer.from(image.pixels),
    width: image.width
  }
  const maskOptions = {
    centerX: offset + radius,
    centerY: offset + radius,
    exponent: squircleExponent,
    radius
  }

  for (let y = 0; y < output.height; y += 1) {
    for (let x = 0; x < output.width; x += 1) {
      const index = (y * output.width + x) * 4
      const alpha = output.pixels[index + 3]
      if (alpha === 0) continue

      const coverage = superellipseCoverage(x, y, maskOptions)
      if (coverage <= 0) {
        output.pixels[index] = 0
        output.pixels[index + 1] = 0
        output.pixels[index + 2] = 0
        output.pixels[index + 3] = 0
        continue
      }

      if (coverage < 1) {
        output.pixels[index + 3] = Math.round(alpha * coverage)
      }
    }
  }

  return output
}

const frameImage = (image, { contentRatio, outputSize }) => {
  const contentSize = Math.round(outputSize * contentRatio)
  const offset = Math.round((outputSize - contentSize) / 2)
  const scaledImage = cropScaleImage(image, {
    cropSize: image.width,
    left: 0,
    outputSize: contentSize,
    top: 0
  })
  const output = {
    height: outputSize,
    pixels: Buffer.alloc(outputSize * outputSize * 4),
    width: outputSize
  }

  for (let y = 0; y < contentSize; y += 1) {
    const sourceStart = y * contentSize * 4
    const targetStart = ((y + offset) * outputSize + offset) * 4
    scaledImage.pixels.copy(output.pixels, targetStart, sourceStart, sourceStart + contentSize * 4)
  }

  return output
}

const resizeImageSet = (image, { pngSizes, sourceIconSize }) => {
  const pngBySize = new Map()

  for (const size of pngSizes) {
    const sizedImage = size === sourceIconSize
      ? image
      : cropScaleImage(image, {
        cropSize: sourceIconSize,
        left: 0,
        outputSize: size,
        top: 0
      })
    pngBySize.set(size, writePngBuffer(sizedImage))
  }

  return pngBySize
}

const writeMacOsPngs = (
  sourcePng,
  {
    frameContentRatio,
    pngSizes,
    sourceIconSize,
    squircleExponent
  }
) => {
  const sourceImage = Buffer.isBuffer(sourcePng) ? decodePng(sourcePng) : readPng(sourcePng)
  const framedImage = frameImage(sourceImage, {
    contentRatio: frameContentRatio,
    outputSize: sourceIconSize
  })
  const macOsImage = maskMacOsIcon(framedImage, {
    contentRatio: frameContentRatio,
    outputSize: sourceIconSize,
    squircleExponent
  })

  return resizeImageSet(macOsImage, { pngSizes, sourceIconSize })
}

const writeFilledPngs = (sourcePath, { pngSizes, sourceContentRatio, sourceIconSize }) => {
  const sourceImage = removeTransparentLightMatte(readPng(sourcePath))
  return writeFilledPngsFromImage(sourceImage, { pngSizes, sourceContentRatio, sourceIconSize })
}

const writeFilledPngsFromImage = (sourceImage, { pngSizes, sourceContentRatio, sourceIconSize }) => {
  const crop = filledCrop(sourceImage.width, sourceContentRatio)
  const filledImage = cropScaleImage(sourceImage, {
    ...crop,
    outputSize: sourceIconSize
  })
  const pngBySize = new Map()

  for (const size of pngSizes) {
    const image = size === sourceIconSize
      ? filledImage
      : cropScaleImage(filledImage, {
        cropSize: sourceIconSize,
        left: 0,
        outputSize: size,
        top: 0
      })
    pngBySize.set(size, writePngBuffer(image))
  }

  return pngBySize
}

module.exports = {
  filledCrop,
  writeFilledPngsFromImage,
  writeMacOsPngs,
  writeFilledPngs
}

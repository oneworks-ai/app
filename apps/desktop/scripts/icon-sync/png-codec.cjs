const { Buffer } = require('node:buffer')
const fs = require('node:fs')
const zlib = require('node:zlib')

const crcTable = new Uint32Array(256)
for (let index = 0; index < 256; index += 1) {
  let value = index
  for (let bit = 0; bit < 8; bit += 1) {
    value = (value & 1) === 1 ? 0xEDB88320 ^ (value >>> 1) : value >>> 1
  }
  crcTable[index] = value >>> 0
}

const crc32 = (buffers) => {
  let crc = 0xFFFFFFFF
  for (const buffer of buffers) {
    for (const byte of buffer) {
      crc = crcTable[(crc ^ byte) & 0xFF] ^ (crc >>> 8)
    }
  }
  return (crc ^ 0xFFFFFFFF) >>> 0
}

const pngSignature = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])

const assertPngSignature = (buffer) => {
  if (buffer.subarray(0, pngSignature.length).equals(pngSignature)) return
  throw new Error('Unsupported icon PNG: invalid PNG signature')
}

const paethPredictor = (left, up, upLeft) => {
  const estimate = left + up - upLeft
  const leftDistance = Math.abs(estimate - left)
  const upDistance = Math.abs(estimate - up)
  const upLeftDistance = Math.abs(estimate - upLeft)
  if (leftDistance <= upDistance && leftDistance <= upLeftDistance) return left
  return upDistance <= upLeftDistance ? up : upLeft
}

const decodePng = (buffer) => {
  assertPngSignature(buffer)

  let width
  let height
  let colorType
  let bitDepth
  const idatChunks = []
  let offset = pngSignature.length

  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset)
    const type = buffer.toString('ascii', offset + 4, offset + 8)
    const data = buffer.subarray(offset + 8, offset + 8 + length)
    offset += 12 + length

    if (type === 'IHDR') {
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      bitDepth = data[8]
      colorType = data[9]
      continue
    }
    if (type === 'IDAT') {
      idatChunks.push(data)
    }
    if (type === 'IEND') break
  }

  if (width == null || height == null || bitDepth !== 8 || colorType !== 6) {
    throw new Error('Unsupported icon PNG: expected 8-bit RGBA')
  }

  const bytesPerPixel = 4
  const stride = width * bytesPerPixel
  const inflated = zlib.inflateSync(Buffer.concat(idatChunks))
  const pixels = Buffer.alloc(width * height * bytesPerPixel)
  let inputOffset = 0

  for (let y = 0; y < height; y += 1) {
    const filter = inflated[inputOffset]
    inputOffset += 1
    const rowStart = y * stride
    const previousRowStart = rowStart - stride

    for (let x = 0; x < stride; x += 1) {
      const raw = inflated[inputOffset]
      inputOffset += 1

      const left = x >= bytesPerPixel ? pixels[rowStart + x - bytesPerPixel] : 0
      const up = y > 0 ? pixels[previousRowStart + x] : 0
      const upLeft = y > 0 && x >= bytesPerPixel ? pixels[previousRowStart + x - bytesPerPixel] : 0

      let value
      if (filter === 0) value = raw
      else if (filter === 1) value = raw + left
      else if (filter === 2) value = raw + up
      else if (filter === 3) value = raw + Math.floor((left + up) / 2)
      else if (filter === 4) value = raw + paethPredictor(left, up, upLeft)
      else throw new Error(`Unsupported PNG filter: ${filter}`)

      pixels[rowStart + x] = value & 0xFF
    }
  }

  return { height, pixels, width }
}

const readPng = filePath => decodePng(fs.readFileSync(filePath))

const pngChunk = (type, data = Buffer.alloc(0)) => {
  const typeBuffer = Buffer.from(type, 'ascii')
  const chunk = Buffer.alloc(12 + data.length)
  chunk.writeUInt32BE(data.length, 0)
  typeBuffer.copy(chunk, 4)
  data.copy(chunk, 8)
  chunk.writeUInt32BE(crc32([typeBuffer, data]), 8 + data.length)
  return chunk
}

const writePngBuffer = ({ height, pixels, width }) => {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0

  const stride = width * 4
  const scanlines = Buffer.alloc((stride + 1) * height)
  for (let y = 0; y < height; y += 1) {
    const rowOffset = y * (stride + 1)
    scanlines[rowOffset] = 0
    pixels.copy(scanlines, rowOffset + 1, y * stride, y * stride + stride)
  }

  return Buffer.concat([
    pngSignature,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(scanlines, { level: 9 })),
    pngChunk('IEND')
  ])
}

module.exports = {
  decodePng,
  readPng,
  writePngBuffer
}

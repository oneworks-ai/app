const { Buffer } = require('node:buffer')

const writeUInt16LE = (buffer, value, offset) => {
  buffer.writeUInt16LE(value, offset)
}

const writeUInt32LE = (buffer, value, offset) => {
  buffer.writeUInt32LE(value, offset)
}

const writeUInt32BE = (buffer, value, offset) => {
  buffer.writeUInt32BE(value, offset)
}

const createIco = (pngBySize, icoSizes) => {
  const entries = icoSizes.map(size => ({ data: pngBySize.get(size), size })).filter(entry => entry.data)
  const headerSize = 6 + entries.length * 16
  const totalSize = headerSize + entries.reduce((sum, entry) => sum + entry.data.length, 0)
  const output = Buffer.alloc(totalSize)
  writeUInt16LE(output, 0, 0)
  writeUInt16LE(output, 1, 2)
  writeUInt16LE(output, entries.length, 4)

  let imageOffset = headerSize
  entries.forEach((entry, index) => {
    const offset = 6 + index * 16
    output[offset] = entry.size >= 256 ? 0 : entry.size
    output[offset + 1] = entry.size >= 256 ? 0 : entry.size
    output[offset + 2] = 0
    output[offset + 3] = 0
    writeUInt16LE(output, 1, offset + 4)
    writeUInt16LE(output, 32, offset + 6)
    writeUInt32LE(output, entry.data.length, offset + 8)
    writeUInt32LE(output, imageOffset, offset + 12)
    entry.data.copy(output, imageOffset)
    imageOffset += entry.data.length
  })

  return output
}

const createIcns = (pngBySize, icnsSizes) => {
  const typeBySize = new Map([
    [16, 'icp4'],
    [32, 'icp5'],
    [64, 'icp6'],
    [128, 'ic07'],
    [256, 'ic08'],
    [512, 'ic09'],
    [1024, 'ic10']
  ])
  const chunks = []
  for (const size of icnsSizes) {
    const data = pngBySize.get(size)
    const type = typeBySize.get(size)
    if (!data || !type) continue

    const header = Buffer.alloc(8)
    header.write(type, 0, 4, 'ascii')
    writeUInt32BE(header, data.length + 8, 4)
    chunks.push(header, data)
  }

  const totalSize = 8 + chunks.reduce((sum, chunk) => sum + chunk.length, 0)
  const header = Buffer.alloc(8)
  header.write('icns', 0, 4, 'ascii')
  writeUInt32BE(header, totalSize, 4)
  return Buffer.concat([header, ...chunks], totalSize)
}

module.exports = {
  createIcns,
  createIco
}

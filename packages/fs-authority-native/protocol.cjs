'use strict'
const { Buffer } = require('node:buffer')
const { MAX_FRAME_BYTES } = require('./constants.cjs')
const MAX_QUEUED_FRAMES = 64
const encodeFrame = value => {
  const payload = Buffer.from(JSON.stringify(value), 'utf8')
  if (payload.length === 0 || payload.length > MAX_FRAME_BYTES) throw new Error('Filesystem authority frame is invalid')
  const frame = Buffer.allocUnsafe(payload.length + 4)
  frame.writeUInt32BE(payload.length, 0)
  payload.copy(frame, 4)
  return frame
}
const createFrameChannel = (stream, initialBytes) => {
  const queued = []
  const waiting = []
  let buffered = Buffer.alloc(0)
  let failure
  const fail = error => {
    failure ??= error
    queued.splice(0)
    for (const waiter of waiting.splice(0)) waiter.reject(failure)
  }
  const deliver = value => {
    const waiter = waiting.shift()
    if (waiter != null) {
      waiter.resolve(value)
      return true
    }
    if (queued.length >= MAX_QUEUED_FRAMES) return false
    queued.push(value)
    return true
  }
  const onData = chunk => {
    if (buffered.length + chunk.length > MAX_FRAME_BYTES + 4) {
      fail(new Error('Filesystem authority channel buffer is full'))
      stream.destroy()
      return
    }
    buffered = Buffer.concat([buffered, chunk])
    while (buffered.length >= 4) {
      const size = buffered.readUInt32BE(0)
      if (size === 0 || size > MAX_FRAME_BYTES) {
        fail(new Error('Filesystem authority frame length is invalid'))
        stream.destroy()
        return
      }
      if (buffered.length < size + 4) return
      const payload = buffered.subarray(4, size + 4)
      buffered = buffered.subarray(size + 4)
      try {
        const value = JSON.parse(payload.toString('utf8'))
        if (value == null || typeof value !== 'object' || Array.isArray(value)) {
          throw new Error('Filesystem authority frame payload is invalid')
        }
        if (!deliver(value)) {
          fail(new Error('Filesystem authority channel queue is full'))
          stream.destroy()
          return
        }
      } catch (error) {
        fail(error)
        stream.destroy()
        return
      }
    }
  }
  stream.on('data', onData)
  stream.once('error', fail)
  stream.once('close', () => fail(new Error('Filesystem authority connection closed')))
  if (initialBytes?.length > 0) onData(initialBytes)
  return {
    next(timeoutMs) {
      if (queued.length > 0) return Promise.resolve(queued.shift())
      if (failure != null) return Promise.reject(failure)
      return new Promise((resolve, reject) => {
        const waiter = { resolve, reject }
        const timer = timeoutMs == null
          ? undefined
          : setTimeout(() => {
            const index = waiting.indexOf(waiter)
            if (index !== -1) waiting.splice(index, 1)
            reject(new Error('Filesystem authority response timed out'))
          }, timeoutMs)
        timer?.unref()
        waiter.resolve = value => {
          if (timer != null) clearTimeout(timer)
          resolve(value)
        }
        waiter.reject = error => {
          if (timer != null) clearTimeout(timer)
          reject(error)
        }
        waiting.push(waiter)
      })
    }
  }
}
module.exports = { createFrameChannel, encodeFrame }

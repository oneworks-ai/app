import { describe, expect, it } from 'vitest'

import { RELAY_CONTROL_MAX_FRAME_BYTES, applyRelayControlHeartbeatFrame } from '../src/platform/control-heartbeat.js'

const oversizedFrames = [
  'x'.repeat(RELAY_CONTROL_MAX_FRAME_BYTES + 1),
  new Uint8Array(RELAY_CONTROL_MAX_FRAME_BYTES + 1).buffer,
  new Uint8Array(RELAY_CONTROL_MAX_FRAME_BYTES + 1),
  [new Uint8Array(32 * 1024), new Uint8Array(32 * 1024 + 1)]
]

describe('relay control heartbeat frame limits', () => {
  it.each(oversizedFrames)('rejects an oversized frame before touching storage', async frame => {
    const result = await applyRelayControlHeartbeatFrame({
      args: {} as never,
      attachment: {} as never,
      frame,
      repository: {} as never
    })

    expect(result).toBe('frame-too-large')
  })
})

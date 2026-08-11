import type { PluginManifest } from '@oneworks/types'
import { describe, expect, it } from 'vitest'

import { hasFirstPartyPluginCapability } from '#~/services/plugins/first-party-capabilities.js'

const manifest = {
  plugin: {
    server: {
      capabilities: ['oneworksChannel'],
      roles: ['workspace']
    }
  }
} satisfies PluginManifest

describe('first-party plugin capabilities', () => {
  it('requires both a bundled source and an explicit trusted manifest capability', () => {
    expect(hasFirstPartyPluginCapability({ sourceGroup: 'builtIn' }, manifest, 'oneworksChannel')).toBe(true)
    expect(hasFirstPartyPluginCapability({ sourceGroup: 'project' }, manifest, 'oneworksChannel')).toBe(false)
    expect(hasFirstPartyPluginCapability({ sourceGroup: 'builtIn' }, {
      plugin: { server: { roles: ['workspace'] } }
    }, 'oneworksChannel')).toBe(false)
  })

  it('allows only bundled plugins to request the Room Relay capability', () => {
    const relayManifest = {
      plugin: {
        server: {
          capabilities: ['roomRelay'],
          roles: ['workspace']
        }
      }
    } satisfies PluginManifest

    expect(hasFirstPartyPluginCapability({ sourceGroup: 'builtIn' }, relayManifest, 'roomRelay')).toBe(true)
    expect(hasFirstPartyPluginCapability({ sourceGroup: 'project' }, relayManifest, 'roomRelay')).toBe(false)
  })
})

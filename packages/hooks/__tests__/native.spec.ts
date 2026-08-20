import { describe, expect, it } from 'vitest'

import { prepareManagedHookRuntime, resolveManagedHookNodePath } from '#~/native.js'

describe('managed hook Node runtime', () => {
  it('preserves an inherited packaged headless runtime', () => {
    const env = {
      HOME: '/fixture/home',
      __ONEWORKS_PROJECT_NODE_PATH__: ' /fixture/One Works Helper '
    }

    expect(resolveManagedHookNodePath(env)).toBe('/fixture/One Works Helper')
    expect(prepareManagedHookRuntime({ cwd: '/fixture/workspace', env })).toMatchObject({
      nodePath: '/fixture/One Works Helper'
    })
    expect(env.__ONEWORKS_PROJECT_NODE_PATH__).toBe('/fixture/One Works Helper')
  })

  it('falls back to the current Node executable outside packaged Desktop', () => {
    expect(resolveManagedHookNodePath({})).toBe(process.execPath)
  })
})

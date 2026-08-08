import { describe, expect, it } from 'vitest'

import { sanitizeInheritedNodeRuntimeEnv, sanitizeOneWorksLoaderEnv } from '#~/process-env.js'

const pollutedEnv = {
  HOME: '/tmp/home',
  NODE_OPTIONS: '--require=/tmp/foreign-preload.cjs',
  NODE_PATH: '/tmp/foreign-node-modules',
  __IS_LOADER_CLI__: 'true',
  __IS_ONEWORKS_HOOK_LOADER__: 'true',
  __ONEWORKS_CLI_HELPER_LOADER_ACTIVE__: 'true',
  __ONEWORKS_HOOK_LOADER_ACTIVE__: 'true'
}

describe('process environment sanitizers', () => {
  it('removes One Works loader state without dropping user Node paths', () => {
    expect(sanitizeOneWorksLoaderEnv(pollutedEnv)).toEqual({
      HOME: '/tmp/home',
      NODE_OPTIONS: '--require=/tmp/foreign-preload.cjs',
      NODE_PATH: '/tmp/foreign-node-modules'
    })
  })

  it('removes host Node runtime state at standalone process boundaries', () => {
    expect(sanitizeInheritedNodeRuntimeEnv(pollutedEnv)).toEqual({
      HOME: '/tmp/home'
    })
  })
})

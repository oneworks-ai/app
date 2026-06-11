import { describe, expect, it } from 'vitest'

import {
  isChannelSessionRuntimeEnv,
  mergeDefaultChannelSessionPermissions
} from '#~/default-channel-session-permissions.js'

describe('default channel session permissions', () => {
  it('does not add channel CLI permissions outside channel runtimes', () => {
    expect(isChannelSessionRuntimeEnv({})).toBe(false)
    expect(
      mergeDefaultChannelSessionPermissions({
        projectConfig: {
          permissions: {
            allow: ['Read']
          }
        },
        env: {}
      })[0]?.permissions?.allow
    ).toEqual(['Read'])
  })

  it('adds built-in channel CLI permissions for channel runtimes without writing project config', () => {
    const [projectConfig, userConfig] = mergeDefaultChannelSessionPermissions({
      env: {
        __ONEWORKS_PROJECT_CHANNEL_TYPE__: 'wechat',
        __ONEWORKS_PROJECT_CHANNEL_KEY__: 'erjie'
      }
    })

    expect(isChannelSessionRuntimeEnv({
      __ONEWORKS_PROJECT_CHANNEL_CONTEXT_PATH__: '/tmp/channel-context.json'
    })).toBe(true)
    expect(projectConfig?.permissions?.allow).toEqual([
      'bash-oneworks-channel-send',
      'bash-oneworks-mem'
    ])
    expect(userConfig).toBeUndefined()
  })

  it('preserves configured project permissions while adding channel defaults', () => {
    const [projectConfig] = mergeDefaultChannelSessionPermissions({
      env: {
        __ONEWORKS_PROJECT_CHANNEL_SESSION_TYPE__: 'group'
      },
      projectConfig: {
        permissions: {
          allow: ['Read'],
          deny: ['Bash(kill:*)']
        }
      }
    })

    expect(projectConfig?.permissions).toEqual({
      allow: ['Read', 'bash-oneworks-channel-send', 'bash-oneworks-mem'],
      deny: ['Bash(kill:*)']
    })
  })
})

import { describe, expect, it } from 'vitest'

import { normalizeCliArgs } from '#~/cli-argv.js'

describe('cli argv normalization', () => {
  it('routes bare invocations to the hidden default command', () => {
    expect(normalizeCliArgs([])).toEqual(['__run'])
    expect(normalizeCliArgs(['explain', 'this'])).toEqual(['__run', 'explain', 'this'])
    expect(normalizeCliArgs(['-A', 'codex', 'explain', 'this'])).toEqual(['__run', '-A', 'codex', 'explain', 'this'])
    expect(normalizeCliArgs(['--resume'])).toEqual(['__run', '--resume'])
    expect(normalizeCliArgs(['--resume', 'session-1'])).toEqual(['__run', '--resume', 'session-1'])
    expect(normalizeCliArgs(['--fork'])).toEqual(['__run', '--fork'])
    expect(normalizeCliArgs(['--fork', 'session-1'])).toEqual(['__run', '--fork', 'session-1'])
  })

  it('preserves explicit subcommands and help/version flags', () => {
    expect(normalizeCliArgs(['run', 'hello'])).toEqual(['__run', 'run', 'hello'])
    expect(normalizeCliArgs(['__run', '--print', 'hi'])).toEqual(['__run', '--print', 'hi'])
    expect(normalizeCliArgs(['list'])).toEqual(['list'])
    expect(normalizeCliArgs(['login'])).toEqual(['login'])
    expect(normalizeCliArgs(['logout'])).toEqual(['logout'])
    expect(normalizeCliArgs(['users', 'enable'])).toEqual(['users', 'enable'])
    expect(normalizeCliArgs(['config', 'list'])).toEqual(['config', 'list'])
    expect(normalizeCliArgs(['daemon'])).toEqual(['daemon'])
    expect(normalizeCliArgs(['benchmark', 'list'])).toEqual(['benchmark', 'list'])
    expect(normalizeCliArgs(['channel', 'erjie', 'send', 'hello'])).toEqual(['channel', 'erjie', 'send', 'hello'])
    expect(normalizeCliArgs(['mem', 'get'])).toEqual(['mem', 'get'])
    expect(normalizeCliArgs(['plugin', '--adapter', 'claude', 'add', 'demo@team-tools'])).toEqual([
      'plugin',
      '--adapter',
      'claude',
      'add',
      'demo@team-tools'
    ])
    expect(normalizeCliArgs(['skills', 'install'])).toEqual(['skills', 'install'])
    expect(normalizeCliArgs(['--help'])).toEqual(['--help'])
    expect(normalizeCliArgs(['-V'])).toEqual(['-V'])
  })

  it('preserves plugin contributed root subcommands', () => {
    expect(normalizeCliArgs(['custom', 'run'], ['custom'])).toEqual(['custom', 'run'])
  })
})

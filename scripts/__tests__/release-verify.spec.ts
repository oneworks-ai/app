import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  parseReleaseVerifyList,
  resolveDesktopReleaseAssetNames,
  runReleaseVerify,
  runReleaseVerifyAgent
} from '../release-verify'
import type { ReleaseVerifyDeps } from '../release-verify'
import {
  listCandidateSessionEventFiles,
  locateSessionEventsPath,
  probeRuntimeSessionEvents,
  waitForRuntimeEvidenceReply
} from '../runtime-evidence'

describe('release verification tooling', () => {
  it('parses comma-separated package lists', () => {
    expect(parseReleaseVerifyList('oneworks, @oneworks/client,,oneork ')).toEqual([
      'oneworks',
      '@oneworks/client',
      'oneork'
    ])
  })

  it('builds default desktop release asset names for both macOS archs', () => {
    expect(resolveDesktopReleaseAssetNames({
      version: '0.1.0-beta.4'
    })).toEqual([
      'oneworks-0.1.0-beta.4-mac-arm64.dmg',
      'oneworks-0.1.0-beta.4-mac-arm64.pkg',
      'oneworks-0.1.0-beta.4-mac-arm64.zip',
      'oneworks-0.1.0-beta.4-mac-x64.dmg',
      'oneworks-0.1.0-beta.4-mac-x64.pkg',
      'oneworks-0.1.0-beta.4-mac-x64.zip'
    ])
  })

  it('extracts assistant replies and completion from runtime event jsonl', () => {
    const probe = probeRuntimeSessionEvents([
      JSON.stringify({ type: 'message', role: 'assistant', content: 'first' }),
      JSON.stringify({ type: 'message', message: { role: 'assistant', content: [{ text: 'OK_BETA' }] } }),
      '{"partial":',
      JSON.stringify({ type: 'session_completed', summary: 'done' }),
      ''
    ].join('\n'))

    expect(probe).toEqual({
      assistantText: 'OK_BETA',
      completed: true,
      lineCount: 3
    })
  })

  it('locates a session events file from an explicit project home', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'oneworks-release-verify-'))
    const projectHome = path.join(root, 'project-home')
    const eventsPath = path.join(projectHome, 'runtime', 'sessions', 'sess-1', 'events.jsonl')
    await mkdir(path.dirname(eventsPath), { recursive: true })
    await writeFile(eventsPath, '{"type":"session_completed"}\n', 'utf8')

    await expect(locateSessionEventsPath({
      homeDir: path.join(root, 'home'),
      projectHome,
      sessionId: 'sess-1'
    })).resolves.toBe(eventsPath)
  })

  it('locates a session events file from the bounded home project search', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'oneworks-release-verify-home-'))
    const homeDir = path.join(root, 'home')
    const eventsPath = path.join(
      homeDir,
      '.oneworks',
      'projects',
      'app-a',
      '.mock',
      '.oneworks',
      'projects',
      'app-b',
      'runtime',
      'sessions',
      'sess-2',
      'events.jsonl'
    )
    await mkdir(path.dirname(eventsPath), { recursive: true })
    await writeFile(eventsPath, '{"type":"session_completed"}\n', 'utf8')

    await expect(locateSessionEventsPath({
      homeDir,
      sessionId: 'sess-2'
    })).resolves.toBe(eventsPath)
  })

  it('lists bounded session event candidates for discovery', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'oneworks-release-verify-candidates-'))
    const homeDir = path.join(root, 'home')
    const eventsPath = path.join(
      homeDir,
      '.oneworks',
      'projects',
      'app-a',
      'runtime',
      'sessions',
      'sess-a',
      'events.jsonl'
    )
    await mkdir(path.dirname(eventsPath), { recursive: true })
    await writeFile(eventsPath, '{"type":"session_completed"}\n', 'utf8')

    await expect(listCandidateSessionEventFiles({
      homeDir
    })).resolves.toEqual([
      {
        eventsPath,
        sessionId: 'sess-a'
      }
    ])
  })

  it('waits for runtime evidence by reply without release-specific state', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'oneworks-runtime-evidence-wait-'))
    const homeDir = path.join(root, 'home')
    const eventsPath = path.join(
      homeDir,
      '.oneworks',
      'projects',
      'app-a',
      'runtime',
      'sessions',
      'sess-wait',
      'events.jsonl'
    )
    await mkdir(path.dirname(eventsPath), { recursive: true })
    await writeFile(
      eventsPath,
      [
        JSON.stringify({ type: 'message', role: 'assistant', content: 'OK_WAIT' }),
        JSON.stringify({ type: 'session_completed' }),
        ''
      ].join('\n'),
      'utf8'
    )
    let now = 1000

    await expect(waitForRuntimeEvidenceReply({
      homeDir,
      expectedReply: 'OK_WAIT',
      waitMs: 1000
    }, {
      now: () => now++,
      sleep: async () => {}
    })).resolves.toMatchObject({
      ok: true,
      sessionId: 'sess-wait'
    })
  })

  it('auto-resolves the target version from the release channel', async () => {
    const output: string[] = []
    let now = 1000
    const deps: ReleaseVerifyDeps = {
      homeDir: () => '/tmp/home',
      now: () => now++,
      platform: () => 'darwin',
      runCommand: async (command, args) => {
        expect(command).toBe('npm')
        expect(args.at(0)).toBe('view')
        expect(args.at(2)).toBe('version')
        return {
          stdout: '"1.2.3-beta.0"\n',
          stderr: ''
        }
      },
      sleep: async () => {}
    }

    const result = await runReleaseVerify({
      channel: 'beta',
      version: 'auto',
      npmPackages: ['oneworks'],
      runtimePackages: [],
      desktopRelease: false,
      desktopApp: false,
      runtimeCache: false,
      stdout: {
        write: (chunk: string) => {
          output.push(chunk)
          return true
        }
      }
    }, deps)

    expect(result).toMatchObject({
      channel: 'beta',
      ok: true,
      scenario: 'desktop-installed',
      version: '1.2.3-beta.0'
    })
    expect(output.join('')).toContain('Verdict: PASS')
    expect(output.join('')).toContain('Target: beta 1.2.3-beta.0')
  })

  it('marks desktop chat verification incomplete until a UI session id is supplied', async () => {
    let now = 1000
    const deps: ReleaseVerifyDeps = {
      homeDir: () => '/tmp/home',
      now: () => now++,
      platform: () => 'darwin',
      runCommand: async () => ({
        stdout: '"1.2.3-beta.0"\n',
        stderr: ''
      }),
      sleep: async () => {}
    }

    const result = await runReleaseVerify({
      channel: 'beta',
      version: 'auto',
      scenario: 'desktop-chat',
      expectedReply: 'OK_RELEASE',
      npmPackages: ['oneworks'],
      runtimePackages: [],
      desktopRelease: false,
      desktopApp: false,
      runtimeCache: false,
      setExitCode: false,
      stdout: {
        write: () => true
      }
    }, deps)

    expect(result.ok).toBe(false)
    expect(result.checks.at(-1)).toMatchObject({
      name: 'desktop chat UI scenario',
      ok: false
    })
    expect(result.recommendations.join('\n')).toContain('Drive the Electron UI')
  })

  it('discovers a completed UI chat session by expected assistant reply', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'oneworks-release-verify-discovery-'))
    const homeDir = path.join(root, 'home')
    const eventsPath = path.join(
      homeDir,
      '.oneworks',
      'projects',
      'app-a',
      'runtime',
      'sessions',
      'sess-auto',
      'events.jsonl'
    )
    await mkdir(path.dirname(eventsPath), { recursive: true })
    await writeFile(
      eventsPath,
      [
        JSON.stringify({ type: 'message', role: 'assistant', content: 'OK_RELEASE_AUTO' }),
        JSON.stringify({ type: 'session_completed' }),
        ''
      ].join('\n'),
      'utf8'
    )
    let now = 1000
    const deps: ReleaseVerifyDeps = {
      homeDir: () => homeDir,
      now: () => now++,
      platform: () => 'darwin',
      runCommand: async () => ({
        stdout: '"1.2.3-beta.0"\n',
        stderr: ''
      }),
      sleep: async () => {}
    }

    const result = await runReleaseVerify({
      channel: 'beta',
      version: 'auto',
      scenario: 'desktop-chat',
      expectedReply: 'OK_RELEASE_AUTO',
      discoverSession: true,
      npmPackages: ['oneworks'],
      runtimePackages: [],
      desktopRelease: false,
      desktopApp: false,
      runtimeCache: false,
      runtimeCacheHome: homeDir,
      setExitCode: false,
      stdout: {
        write: () => true
      }
    }, deps)

    expect(result.ok).toBe(true)
    expect(result.checks.at(-1)).toMatchObject({
      name: 'runtime session reply',
      ok: true
    })
    expect(result.checks.at(-1)?.message).toContain('sess-auto')
  })

  it('agent mode prints a UI action and discovers matching chat evidence', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'oneworks-release-verify-agent-'))
    const homeDir = path.join(root, 'home')
    const eventsPath = path.join(
      homeDir,
      '.oneworks',
      'projects',
      'app-a',
      'runtime',
      'sessions',
      'sess-agent',
      'events.jsonl'
    )
    await mkdir(path.dirname(eventsPath), { recursive: true })
    await writeFile(
      eventsPath,
      [
        JSON.stringify({ type: 'message', role: 'assistant', content: 'OK_AGENT' }),
        JSON.stringify({ type: 'session_completed' }),
        ''
      ].join('\n'),
      'utf8'
    )
    const output: string[] = []
    let now = 1000
    const deps: ReleaseVerifyDeps = {
      homeDir: () => homeDir,
      now: () => now++,
      platform: () => 'darwin',
      runCommand: async () => ({
        stdout: '"1.2.3-beta.0"\n',
        stderr: ''
      }),
      sleep: async () => {}
    }

    const result = await runReleaseVerifyAgent({
      channel: 'beta',
      version: 'auto',
      expectedReply: 'OK_AGENT',
      npmPackages: ['oneworks'],
      runtimePackages: [],
      desktopRelease: false,
      desktopApp: false,
      runtimeCache: false,
      runtimeCacheHome: homeDir,
      setExitCode: false,
      stdout: {
        write: (chunk: string) => {
          output.push(chunk)
          return true
        }
      }
    }, deps)

    expect(result.ok).toBe(true)
    expect(result.expectedReply).toBe('OK_AGENT')
    expect(output.join('')).toContain('UI action')
    expect(output.join('')).toContain('session id is optional')
  })
})

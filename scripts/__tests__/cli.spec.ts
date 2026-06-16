/* eslint-disable max-lines -- CLI command dispatch tests stay together to keep command coverage searchable. */
import { describe, expect, it, vi } from 'vitest'

import { createScriptsCli } from '../cli'

describe('scripts cli', () => {
  it('dispatches dev-start through the standard launcher', async () => {
    const runDevStart = vi.fn(async () => {})
    const cli = createScriptsCli({
      runDevStart
    })

    await cli.parseAsync(['node', 'oneworks-dev', 'dev-start', 'electron', '--workspace'])

    expect(runDevStart).toHaveBeenCalledWith({
      target: 'electron',
      serviceChild: false,
      workspace: true
    })
  })

  it('dispatches adapter e2e run through the shared suite', async () => {
    const runAdapterSuite = vi.fn(async () => [])
    const cli = createScriptsCli({
      runAdapterSuite,
      runAdapterVitest: vi.fn(async () => {}),
      runChromeDebugTargets: vi.fn(async () => {}),
      runChromeDebugMessengerConversations: vi.fn(async () => {}),
      runChromeDebugMessengerSend: vi.fn(async () => {}),
      runChromeDebugMessengerClickReply: vi.fn(async () => {}),
      runChromeDebugMessengerClickText: vi.fn(async () => {}),
      runMessageActionsVerify: vi.fn(async () => {}),
      runPublishPlan: vi.fn(async () => ({}))
    })

    await cli.parseAsync(['node', 'oneworks-dev', 'adapter-e2e', 'run', 'codex', '--quiet'])

    expect(runAdapterSuite).toHaveBeenCalledWith('codex', {
      passthroughStdIO: false,
      printSummary: true
    })
  })

  it('dispatches adapter e2e test with verbose mode', async () => {
    const runAdapterVitest = vi.fn(async () => {})
    const cli = createScriptsCli({
      runAdapterSuite: vi.fn(async () => []),
      runAdapterVitest,
      runChromeDebugTargets: vi.fn(async () => {}),
      runChromeDebugMessengerConversations: vi.fn(async () => {}),
      runChromeDebugMessengerSend: vi.fn(async () => {}),
      runChromeDebugMessengerClickReply: vi.fn(async () => {}),
      runChromeDebugMessengerClickText: vi.fn(async () => {}),
      runMessageActionsVerify: vi.fn(async () => {}),
      runPublishPlan: vi.fn(async () => ({}))
    })

    await cli.parseAsync([
      'node',
      'oneworks-dev',
      'adapter-e2e',
      'test',
      'codex-read-once',
      '--verbose',
      '--update'
    ])

    expect(runAdapterVitest).toHaveBeenCalledWith({
      selection: 'codex-read-once',
      updateSnapshots: true,
      verbose: true
    })
  })

  it('passes through publish plan arguments after --', async () => {
    const runPublishPlan = vi.fn(async () => ({}))
    const cli = createScriptsCli({
      runAdapterSuite: vi.fn(async () => []),
      runAdapterVitest: vi.fn(async () => {}),
      runChromeDebugTargets: vi.fn(async () => {}),
      runChromeDebugMessengerConversations: vi.fn(async () => {}),
      runChromeDebugMessengerSend: vi.fn(async () => {}),
      runChromeDebugMessengerClickReply: vi.fn(async () => {}),
      runChromeDebugMessengerClickText: vi.fn(async () => {}),
      runMessageActionsVerify: vi.fn(async () => {}),
      runPublishPlan
    })

    await cli.parseAsync(['node', 'oneworks-dev', 'publish-plan', '--', '--publish', '--tag', 'next'])

    expect(runPublishPlan).toHaveBeenCalledWith(['--publish', '--tag', 'next'])
  })

  it('dispatches release tag planning with json output', async () => {
    const runReleaseTagsPlan = vi.fn(async () => ({
      base: 'base-sha',
      head: 'head-sha',
      tags: []
    }))
    const cli = createScriptsCli({
      runReleaseTagsPlan
    })

    await cli.parseAsync([
      'node',
      'oneworks-dev',
      'release-tags',
      'plan',
      'base-sha',
      'head-sha',
      '--json'
    ])

    expect(runReleaseTagsPlan).toHaveBeenCalledWith({
      base: 'base-sha',
      head: 'head-sha',
      json: true
    })
  })

  it('dispatches PR change policy checks with PR body file', async () => {
    const runPrChangeCheck = vi.fn(async () => {})
    const cli = createScriptsCli({
      runPrChangeCheck
    })

    await cli.parseAsync([
      'node',
      'oneworks-dev',
      'pr-change-check',
      'base-sha',
      'head-sha',
      '--body-file',
      '/tmp/pr-body.md'
    ])

    expect(runPrChangeCheck).toHaveBeenCalledWith({
      base: 'base-sha',
      head: 'head-sha',
      body: undefined,
      bodyFile: '/tmp/pr-body.md'
    })
  })

  it('dispatches chrome debug targets with parsed options', async () => {
    const runChromeDebugTargets = vi.fn(async () => {})
    const cli = createScriptsCli({
      runAdapterSuite: vi.fn(async () => []),
      runAdapterVitest: vi.fn(async () => {}),
      runChromeDebugTargets,
      runChromeDebugMessengerConversations: vi.fn(async () => {}),
      runChromeDebugMessengerSend: vi.fn(async () => {}),
      runChromeDebugMessengerClickReply: vi.fn(async () => {}),
      runChromeDebugMessengerClickText: vi.fn(async () => {}),
      runMessageActionsVerify: vi.fn(async () => {}),
      runPublishPlan: vi.fn(async () => ({}))
    })

    await cli.parseAsync(['node', 'oneworks-dev', 'chrome-debug', 'targets', '--port', '9333', '--json'])

    expect(runChromeDebugTargets).toHaveBeenCalledWith({
      port: 9333,
      json: true
    })
  })

  it('dispatches chrome debug messenger send with defaults', async () => {
    const runChromeDebugMessengerSend = vi.fn(async () => {})
    const cli = createScriptsCli({
      runAdapterSuite: vi.fn(async () => []),
      runAdapterVitest: vi.fn(async () => {}),
      runChromeDebugTargets: vi.fn(async () => {}),
      runChromeDebugMessengerConversations: vi.fn(async () => {}),
      runChromeDebugMessengerSend,
      runChromeDebugMessengerClickReply: vi.fn(async () => {}),
      runChromeDebugMessengerClickText: vi.fn(async () => {}),
      runMessageActionsVerify: vi.fn(async () => {}),
      runPublishPlan: vi.fn(async () => ({}))
    })

    await cli.parseAsync([
      'node',
      'oneworks-dev',
      'chrome-debug',
      'messenger-send',
      '二介',
      '/reset',
      '--replace-draft',
      '--settle-ms',
      '2500'
    ])

    expect(runChromeDebugMessengerSend).toHaveBeenCalledWith({
      port: 9222,
      pageUrlSubstring: '/next/messenger',
      conversation: '二介',
      message: '/reset',
      replaceDraft: true,
      settleMs: 2500
    })
  })

  it('dispatches chrome debug messenger conversation listing with defaults', async () => {
    const runChromeDebugMessengerConversations = vi.fn(async () => {})
    const cli = createScriptsCli({
      runAdapterSuite: vi.fn(async () => []),
      runAdapterVitest: vi.fn(async () => {}),
      runChromeDebugTargets: vi.fn(async () => {}),
      runChromeDebugMessengerConversations,
      runChromeDebugMessengerSend: vi.fn(async () => {}),
      runChromeDebugMessengerClickReply: vi.fn(async () => {}),
      runChromeDebugMessengerClickText: vi.fn(async () => {}),
      runMessageActionsVerify: vi.fn(async () => {}),
      runPublishPlan: vi.fn(async () => ({}))
    })

    await cli.parseAsync([
      'node',
      'oneworks-dev',
      'chrome-debug',
      'messenger-conversations'
    ])

    expect(runChromeDebugMessengerConversations).toHaveBeenCalledWith({
      port: 9222,
      pageUrlSubstring: '/next/messenger'
    })
  })

  it('dispatches chrome debug messenger reply clicks with defaults', async () => {
    const runChromeDebugMessengerClickReply = vi.fn(async () => {})
    const cli = createScriptsCli({
      runAdapterSuite: vi.fn(async () => []),
      runAdapterVitest: vi.fn(async () => {}),
      runChromeDebugTargets: vi.fn(async () => {}),
      runChromeDebugMessengerConversations: vi.fn(async () => {}),
      runChromeDebugMessengerSend: vi.fn(async () => {}),
      runChromeDebugMessengerClickReply,
      runChromeDebugMessengerClickText: vi.fn(async () => {}),
      runMessageActionsVerify: vi.fn(async () => {}),
      runPublishPlan: vi.fn(async () => ({}))
    })

    await cli.parseAsync([
      'node',
      'oneworks-dev',
      'chrome-debug',
      'messenger-click-reply',
      '二介',
      '支持的指令：',
      '--reply-index',
      '2'
    ])

    expect(runChromeDebugMessengerClickReply).toHaveBeenCalledWith({
      port: 9222,
      pageUrlSubstring: '/next/messenger',
      conversation: '二介',
      messageSnippet: '支持的指令：',
      replyIndex: 2,
      settleMs: 1000
    })
  })

  it('dispatches chrome debug messenger text clicks with defaults', async () => {
    const runChromeDebugMessengerClickText = vi.fn(async () => {})
    const cli = createScriptsCli({
      runAdapterSuite: vi.fn(async () => []),
      runAdapterVitest: vi.fn(async () => {}),
      runChromeDebugTargets: vi.fn(async () => {}),
      runChromeDebugMessengerConversations: vi.fn(async () => {}),
      runChromeDebugMessengerSend: vi.fn(async () => {}),
      runChromeDebugMessengerClickReply: vi.fn(async () => {}),
      runChromeDebugMessengerClickText,
      runMessageActionsVerify: vi.fn(async () => {}),
      runPublishPlan: vi.fn(async () => ({}))
    })

    await cli.parseAsync([
      'node',
      'oneworks-dev',
      'chrome-debug',
      'messenger-click-text',
      '二介',
      '/help --page=2'
    ])

    expect(runChromeDebugMessengerClickText).toHaveBeenCalledWith({
      port: 9222,
      pageUrlSubstring: '/next/messenger',
      conversation: '二介',
      text: '/help --page=2',
      settleMs: 1000
    })
  })

  it('dispatches message actions verification with quiet mode', async () => {
    const runMessageActionsVerify = vi.fn(async () => {})
    const cli = createScriptsCli({
      runAdapterSuite: vi.fn(async () => []),
      runAdapterVitest: vi.fn(async () => {}),
      runChromeDebugTargets: vi.fn(async () => {}),
      runChromeDebugMessengerConversations: vi.fn(async () => {}),
      runChromeDebugMessengerSend: vi.fn(async () => {}),
      runChromeDebugMessengerClickReply: vi.fn(async () => {}),
      runChromeDebugMessengerClickText: vi.fn(async () => {}),
      runMessageActionsVerify,
      runPublishPlan: vi.fn(async () => ({}))
    })

    await cli.parseAsync(['node', 'oneworks-dev', 'message-actions', 'verify', '--quiet'])

    expect(runMessageActionsVerify).toHaveBeenCalledWith({
      quiet: true
    })
  })

  it('dispatches demo video scenario listing', async () => {
    const runDemoVideoList = vi.fn(async () => [])
    const cli = createScriptsCli({
      runDemoVideoList
    })

    await cli.parseAsync(['node', 'oneworks-dev', 'demo-video', 'list', '--json'])

    expect(runDemoVideoList).toHaveBeenCalledWith({
      json: true
    })
  })

  it('dispatches demo video recording options', async () => {
    const runDemoVideoRecord = vi.fn(async () => ({
      colorScheme: 'dark' as const,
      durationMs: 9_000,
      fps: 6,
      frameCount: 54,
      framesDir: '/repo/.logs/demo/frames',
      height: 1000,
      keptFrames: true,
      posterPath: '/repo/.logs/demo/relay-demo-poster.png',
      scenarioId: 'relay-team-config-tabs',
      scenarioTitle: 'Relay 团队配置 Tabs',
      videoPath: '/repo/.logs/demo/relay-demo.mp4',
      width: 1600
    }))
    const cli = createScriptsCli({
      runDemoVideoRecord
    })

    await cli.parseAsync([
      'node',
      'oneworks-dev',
      'demo-video',
      'record',
      'relay-team-config-tabs',
      '--url',
      'http://127.0.0.1:8787/admin/teams',
      '--out-dir',
      '.logs/demo',
      '--name',
      'relay-demo',
      '--width',
      '1600',
      '--height',
      '1000',
      '--fps',
      '6',
      '--duration-ms',
      '9000',
      '--chrome-path',
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '--ffmpeg-path',
      '/opt/homebrew/bin/ffmpeg',
      '--color-scheme',
      'dark',
      '--keep-frames',
      '--json'
    ])

    expect(runDemoVideoRecord).toHaveBeenCalledWith({
      scenarioId: 'relay-team-config-tabs',
      chromePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      colorScheme: 'dark',
      durationMs: 9_000,
      ffmpegPath: '/opt/homebrew/bin/ffmpeg',
      fps: 6,
      height: 1000,
      json: true,
      keepFrames: true,
      name: 'relay-demo',
      outDir: '.logs/demo',
      url: 'http://127.0.0.1:8787/admin/teams',
      width: 1600
    })
  })

  it('dispatches agent room resume smoke', async () => {
    const runAgentRoomResumeSmoke = vi.fn(async () => ({
      ok: true as const,
      tmp: '/tmp/oneworks-agent-room-resume-smoke',
      serverPort: 8787,
      mockServerPort: 8788,
      parentSessionId: 'parent',
      roomTitle: 'Agent room title smoke',
      roomId: 'room',
      taskId: 'task',
      taskTitle: 'Room smoke dev',
      childSessionTitle: 'Room smoke dev',
      runKey: 'run:task',
      runTitle: 'Room smoke dev',
      initialStatus: 'completed',
      resumedStatus: 'completed',
      roomMessagesBefore: 3,
      roomMessagesAfter: 6,
      childMessageTypes: ['message'],
      hasInitialUserMessage: true,
      hasRoomUserMessage: true,
      hasResumeAssistantMessage: true,
      traceBeforeResume: 1,
      traceAfterResume: 2,
      traceDelta: 1,
      newThreadCount: 1,
      resumeThreadCount: 1,
      logPath: '/project-home/logs/parent/task.log.md',
      logsTail: []
    }))
    const cli = createScriptsCli({
      runAdapterSuite: vi.fn(async () => []),
      runAdapterVitest: vi.fn(async () => {}),
      runChromeDebugTargets: vi.fn(async () => {}),
      runChromeDebugMessengerConversations: vi.fn(async () => {}),
      runChromeDebugMessengerSend: vi.fn(async () => {}),
      runChromeDebugMessengerClickReply: vi.fn(async () => {}),
      runChromeDebugMessengerClickText: vi.fn(async () => {}),
      runMessageActionsVerify: vi.fn(async () => {}),
      runAgentRoomResumeSmoke,
      runPublishPlan: vi.fn(async () => ({}))
    })

    await cli.parseAsync(['node', 'oneworks-dev', 'agent-room-smoke', 'resume', '--json'])

    expect(runAgentRoomResumeSmoke).toHaveBeenCalledWith({
      json: true
    })
  })

  it('dispatches relay config smoke with pending and debug options', async () => {
    const runRelayConfigSmoke = vi.fn(async () => ({
      cachePath: '/tmp/oneworks-relay-config-smoke/project-home/.local/plugins/relay/config-snapshot.json',
      ok: false,
      pending: ['pending hook'],
      projectHome: '/tmp/oneworks-relay-config-smoke/project-home',
      tempRoot: '/tmp/oneworks-relay-config-smoke',
      workspaceDir: '/tmp/oneworks-relay-config-smoke/workspace'
    }))
    const cli = createScriptsCli({
      runRelayConfigSmoke
    })

    await cli.parseAsync([
      'node',
      'oneworks-dev',
      'relay-config',
      'smoke',
      '--allow-pending',
      '--json',
      '--keep-temp'
    ])

    expect(runRelayConfigSmoke).toHaveBeenCalledWith({
      allowPending: true,
      json: true,
      keepTemp: true
    })
  })

  it('dispatches relay config live smoke with CI debug options', async () => {
    const runRelayConfigLiveSmoke = vi.fn(async () => ({
      adminAssetBytes: {
        css: 1024,
        js: 2048
      },
      adminShellOk: true,
      assignmentId: 'assignment',
      checks: {
        adminAssets: true,
        adminUserTeamSummary: true,
        configHookMerged: true,
        deviceSnapshot: true,
        secretEnvelopeOnly: true,
        teamPolicy: true
      },
      ok: true as const,
      profileId: 'profile',
      projectHome: '/tmp/oneworks-relay-config-live-smoke/project-home',
      relayUrl: 'http://127.0.0.1:8788',
      snapshotHash: 'sha256:live-smoke',
      teamId: 'team',
      tempRoot: '/tmp/oneworks-relay-config-live-smoke',
      workspaceDir: '/tmp/oneworks-relay-config-live-smoke/workspace'
    }))
    const cli = createScriptsCli({
      runRelayConfigLiveSmoke
    })

    await cli.parseAsync([
      'node',
      'oneworks-dev',
      'relay-config',
      'live-smoke',
      '--json',
      '--keep-temp',
      '--skip-admin-build'
    ])

    expect(runRelayConfigLiveSmoke).toHaveBeenCalledWith({
      json: true,
      keepTemp: true,
      skipAdminBuild: true
    })
  })

  it('dispatches homebrew tap OneWorks formula sync', async () => {
    const runHomebrewTapSyncOneWorks = vi.fn(async () => ({
      formulaPath: '/repo/infra/homebrew-tap/Formula/oneworks.rb',
      sha256: '0'.repeat(64),
      tarballUrl: 'https://registry.npmjs.org/oneworks/-/oneworks-1.2.3.tgz',
      written: true
    }))
    const cli = createScriptsCli({
      runAdapterSuite: vi.fn(async () => []),
      runAdapterVitest: vi.fn(async () => {}),
      runChromeDebugTargets: vi.fn(async () => {}),
      runChromeDebugMessengerConversations: vi.fn(async () => {}),
      runChromeDebugMessengerSend: vi.fn(async () => {}),
      runChromeDebugMessengerClickReply: vi.fn(async () => {}),
      runChromeDebugMessengerClickText: vi.fn(async () => {}),
      runMessageActionsVerify: vi.fn(async () => {}),
      runHomebrewTapSyncOneWorks,
      runPublishPlan: vi.fn(async () => ({}))
    })

    await cli.parseAsync([
      'node',
      'oneworks-dev',
      'homebrew-tap',
      'sync-oneworks',
      '--version',
      '1.2.3',
      '--tap-dir',
      'infra/homebrew-tap',
      '--dry-run'
    ])

    expect(runHomebrewTapSyncOneWorks).toHaveBeenCalledWith({
      version: '1.2.3',
      tapDir: 'infra/homebrew-tap',
      formulaPath: 'Formula/oneworks.rb',
      dryRun: true
    })
  })

  it('dispatches Windows install metadata sync', async () => {
    const runWindowsInstallSyncOneWorks = vi.fn(async () => ({
      scoopManifestPath: '/repo/infra/windows/scoop-bucket/bucket/oneworks.json',
      sha256: '0'.repeat(64),
      tarballUrl: 'https://registry.npmjs.org/oneworks/-/oneworks-1.2.3.tgz',
      wingetInstallerUrl: 'https://example.com/oneworks-windows-1.2.3.zip',
      wingetLocaleManifestPath: '/repo/infra/windows/winget/OneWorks.OneWorks.locale.en-US.yaml',
      wingetTemplatePath: '/repo/infra/windows/winget/OneWorks.OneWorks.installer.template.yaml',
      wingetVersionManifestPath: '/repo/infra/windows/winget/OneWorks.OneWorks.yaml',
      written: true
    }))
    const cli = createScriptsCli({
      runAdapterSuite: vi.fn(async () => []),
      runAdapterVitest: vi.fn(async () => {}),
      runChromeDebugTargets: vi.fn(async () => {}),
      runChromeDebugMessengerConversations: vi.fn(async () => {}),
      runChromeDebugMessengerSend: vi.fn(async () => {}),
      runChromeDebugMessengerClickReply: vi.fn(async () => {}),
      runChromeDebugMessengerClickText: vi.fn(async () => {}),
      runMessageActionsVerify: vi.fn(async () => {}),
      runWindowsInstallSyncOneWorks,
      runPublishPlan: vi.fn(async () => ({}))
    })

    await cli.parseAsync([
      'node',
      'oneworks-dev',
      'windows-install',
      'sync-oneworks',
      '--version',
      '1.2.3',
      '--winget-installer-url',
      'https://example.com/oneworks-windows-1.2.3.zip',
      '--dry-run'
    ])

    expect(runWindowsInstallSyncOneWorks).toHaveBeenCalledWith({
      version: '1.2.3',
      dryRun: true,
      scoopManifestPath: 'infra/windows/scoop-bucket/bucket/oneworks.json',
      wingetInstallerUrl: 'https://example.com/oneworks-windows-1.2.3.zip',
      wingetInstallerSha256: undefined,
      wingetLocaleManifestPath: 'infra/windows/winget/OneWorks.OneWorks.locale.en-US.yaml',
      wingetVersionManifestPath: 'infra/windows/winget/OneWorks.OneWorks.yaml',
      wingetTemplatePath: 'infra/windows/winget/OneWorks.OneWorks.installer.template.yaml'
    })
  })
})

import { Command, Option } from 'commander'
import process from 'node:process'

import { parseAdapterE2ESelection } from './__tests__/adapter-e2e/cases'
import { runAdapterE2ESuite } from './adapter-e2e/harness'
import { runProcess } from './adapter-e2e/runtime'
import { runAgentRoomResumeSmoke } from './agent-room-smoke'
import {
  getDefaultChromeDebugPageUrlSubstring,
  parsePositiveIntegerOption,
  runChromeDebugMessengerClickReply,
  runChromeDebugMessengerClickText,
  runChromeDebugMessengerConversations,
  runChromeDebugMessengerSend,
  runChromeDebugTargets
} from './chrome-debug'
import {
  parseDemoVideoBackgroundColor,
  parseDemoVideoCaptureSource,
  parseDemoVideoColorScheme,
  parseDemoVideoColorSchemeList,
  parseDemoVideoLanguage,
  parseDemoVideoLanguageList,
  parseDemoVideoPageBackground,
  parseDemoVideoSystemWindowCaptureBackend,
  runDemoVideoBatch,
  runDemoVideoList,
  runDemoVideoRecord
} from './demo-video'
import type {
  DemoVideoCaptureSource,
  DemoVideoColorScheme,
  DemoVideoPageBackground,
  DemoVideoSystemWindowCaptureBackend
} from './demo-video'
import { runDesktopCdpLaunch } from './desktop-cdp'
import { runDesktopControlRecordBatch } from './desktop-control-record-batch'
import { runDesktopControlServe } from './desktop-control-server'
import type { DevServiceCommandInput, DevStartTarget } from './dev-start'
import {
  devStartTargets,
  parseDevStartTarget,
  runDevServiceCommand as runDevServiceCommandEntry,
  runDevStart as runDevStartCommand
} from './dev-start'
import { runHomebrewTapSyncOneWorks } from './homebrew-tap'
import { runMessageActionsVerify } from './message-actions'
import { runPrChangeCheck } from './pr-change-check'
import { parseRelayAuthFixtureCommand, runRelayAuthFixture } from './relay-auth-fixture'
import { runRelayConfigLiveSmoke } from './relay-config-live-smoke'
import { runRelayConfigSmoke } from './relay-config-smoke'
import { runReleaseTagsPlan } from './release-tags'
import {
  DEFAULT_DESKTOP_APP_PATH,
  DEFAULT_DESKTOP_BUNDLE_ID,
  DEFAULT_RELEASE_VERIFY_NPM_PACKAGES,
  DEFAULT_RELEASE_VERIFY_REPO,
  DEFAULT_RELEASE_VERIFY_RUNTIME_PACKAGES,
  parseReleaseVerifyList,
  parseReleaseVerifyScenario,
  runReleaseVerify,
  runReleaseVerifyAgent,
  runReleaseVerifyBeta
} from './release-verify'
import { runRuntimeEvidenceList, runRuntimeEvidenceWait } from './runtime-evidence'
import { runWindowsInstallSyncOneWorks } from './windows-install'

const runVitestAdapterE2E = async (input: {
  selection: string | undefined
  updateSnapshots: boolean
  verbose: boolean
}) => {
  const result = await runProcess({
    command: 'pnpm',
    args: [
      'exec',
      'vitest',
      'run',
      '--workspace',
      'vitest.workspace.ts',
      '--project',
      'node',
      'scripts/__tests__/adapter-e2e/adapter-e2e.spec.ts',
      ...(input.updateSnapshots ? ['-u'] : [])
    ],
    env: {
      ...process.env,
      ONEWORKS_RUN_ADAPTER_E2E: '1',
      ONEWORKS_ADAPTER_E2E_SELECTION: parseAdapterE2ESelection(input.selection),
      ...(input.verbose ? { ONEWORKS_E2E_VERBOSE: '1' } : {})
    },
    passthroughStdIO: true
  })

  if (result.code !== 0) {
    process.exitCode = result.code
  }
}

interface ScriptsCliDeps {
  runAdapterSuite: typeof runAdapterE2ESuite
  runAdapterVitest: (input: {
    selection: string | undefined
    updateSnapshots: boolean
    verbose: boolean
  }) => Promise<void>
  runCommitMessageCheck: (input: {
    base?: string
    head?: string
  }) => Promise<void>
  runPrChangeCheck: typeof runPrChangeCheck
  runReleaseTagsPlan: typeof runReleaseTagsPlan
  runReleaseVerify: typeof runReleaseVerify
  runReleaseVerifyAgent: typeof runReleaseVerifyAgent
  runReleaseVerifyBeta: typeof runReleaseVerifyBeta
  runRuntimeEvidenceList: typeof runRuntimeEvidenceList
  runRuntimeEvidenceWait: typeof runRuntimeEvidenceWait
  runDesktopCdpLaunch: typeof runDesktopCdpLaunch
  runDesktopControlRecordBatch: typeof runDesktopControlRecordBatch
  runDesktopControlServe: typeof runDesktopControlServe
  runChromeDebugTargets: typeof runChromeDebugTargets
  runChromeDebugMessengerConversations: typeof runChromeDebugMessengerConversations
  runChromeDebugMessengerSend: typeof runChromeDebugMessengerSend
  runChromeDebugMessengerClickReply: typeof runChromeDebugMessengerClickReply
  runChromeDebugMessengerClickText: typeof runChromeDebugMessengerClickText
  runDemoVideoBatch: typeof runDemoVideoBatch
  runDemoVideoList: typeof runDemoVideoList
  runDemoVideoRecord: typeof runDemoVideoRecord
  runMessageActionsVerify: typeof runMessageActionsVerify
  runHomebrewTapSyncOneWorks: typeof runHomebrewTapSyncOneWorks
  runWindowsInstallSyncOneWorks: typeof runWindowsInstallSyncOneWorks
  runPublishPlan: (args: string[]) => Promise<unknown>
  runAgentRoomResumeSmoke: typeof runAgentRoomResumeSmoke
  runRelayConfigLiveSmoke: typeof runRelayConfigLiveSmoke
  runRelayConfigSmoke: typeof runRelayConfigSmoke
  runRelayAuthFixture: typeof runRelayAuthFixture
  runDevStart: typeof runDevStartCommand
  runDevService: (input: DevServiceCommandInput) => Promise<unknown>
}

const defaultDeps: ScriptsCliDeps = {
  runAdapterSuite: runAdapterE2ESuite,
  runAdapterVitest: runVitestAdapterE2E,
  runCommitMessageCheck: async (input) => {
    const args = ['scripts/check-commit-messages.mjs']
    if (input.base != null) {
      args.push(input.base)
      args.push(input.head ?? 'HEAD')
    }

    const result = await runProcess({
      command: process.execPath,
      args,
      env: process.env,
      passthroughStdIO: true
    })

    if (result.code !== 0) {
      process.exitCode = result.code
    }
  },
  runPrChangeCheck,
  runReleaseTagsPlan,
  runReleaseVerify,
  runReleaseVerifyAgent,
  runReleaseVerifyBeta,
  runRuntimeEvidenceList,
  runRuntimeEvidenceWait,
  runDesktopCdpLaunch,
  runDesktopControlRecordBatch,
  runDesktopControlServe,
  runChromeDebugTargets,
  runChromeDebugMessengerConversations,
  runChromeDebugMessengerSend,
  runChromeDebugMessengerClickReply,
  runChromeDebugMessengerClickText,
  runDemoVideoBatch,
  runDemoVideoList,
  runDemoVideoRecord,
  runMessageActionsVerify,
  runHomebrewTapSyncOneWorks,
  runWindowsInstallSyncOneWorks,
  runPublishPlan: async (args) => {
    const { runPublishPlanCli } = await import('./publish-plan-core.mjs')
    return runPublishPlanCli(args)
  },
  runAgentRoomResumeSmoke,
  runRelayConfigLiveSmoke,
  runRelayConfigSmoke,
  runRelayAuthFixture,
  runDevStart: runDevStartCommand,
  runDevService: runDevServiceCommandEntry
}

const devStartTargetDescriptions: Record<DevStartTarget, string> = {
  web: 'server + Vite client',
  daemon: 'standalone OneWorks management daemon',
  electron: 'Electron launcher without binding this repo as a workspace',
  'electron-workspace': 'Electron with the current repo opened as the workspace',
  pwa: 'server + standalone PWA preview',
  homepage: 'Astro homepage with embedded PWA preview',
  docs: 'local markdown docs preview',
  relay: 'Relay Server + Relay Admin Vite client',
  'desktop-control': 'shared local Electron control protocol bridge',
  'android-emulator': 'shared visible Android emulator'
}

const parseNonNegativeIntegerOption = (value: string, label: string) => {
  if (!/^\d+$/u.test(value)) {
    throw new Error(`${label} must be a non-negative integer.`)
  }
  return Number.parseInt(value, 10)
}

const isStructuredCliError = (error: unknown): error is Error & {
  code: string
  statusCode?: number
} => (
  error instanceof Error &&
  'code' in error &&
  typeof error.code === 'string'
)

const writeStructuredCliError = (
  error: Error & {
    code: string
    statusCode?: number
  }
) => {
  process.stdout.write(`${
    JSON.stringify(
      {
        ok: false,
        error: {
          code: error.code,
          message: error.message,
          ...(typeof error.statusCode === 'number' ? { statusCode: error.statusCode } : {})
        }
      },
      null,
      2
    )
  }\n`)
  process.exitCode = 1
}

export const createScriptsCli = (inputDeps: Partial<ScriptsCliDeps> = {}) => {
  const deps: ScriptsCliDeps = {
    ...defaultDeps,
    ...inputDeps
  }
  const program = new Command()

  program
    .name('oneworks-dev')
    .description('Workspace maintenance commands')

  program
    .command('dev-start [target]')
    .description('Fetch, prepare, and start a local development target')
    .addOption(new Option('--service-child', 'Internal detached service child mode').hideHelp())
    .option('--workspace', 'Open the current repository as the Electron workspace', false)
    .addHelpText(
      'after',
      `\nTargets:\n${
        devStartTargets.map(target => `  ${target.padEnd(18)} ${devStartTargetDescriptions[target]}`).join('\n')
      }`
    )
    .action(async (target: string | undefined, options: {
      serviceChild?: boolean
      workspace?: boolean
    }) => {
      await deps.runDevStart({
        target: parseDevStartTarget(target),
        serviceChild: options.serviceChild ?? false,
        workspace: options.workspace ?? false
      })
    })

  const devServiceCommand = program
    .command('dev-service')
    .description('Coordinate long-lived local development services across agent sessions')

  for (const action of ['ensure', 'restart'] as const) {
    devServiceCommand
      .command(`${action} [target]`)
      .description(`${action === 'ensure' ? 'Start or reuse' : 'Restart'} a managed development target`)
      .option('--workspace', 'Open the current repository as the Electron workspace', false)
      .option('--json', 'Print the resulting shared status document', false)
      .action(async (target: string | undefined, options: { json?: boolean; workspace?: boolean }) => {
        await deps.runDevService({
          action,
          json: options.json ?? false,
          target: parseDevStartTarget(target),
          workspace: options.workspace ?? false
        })
      })
  }

  devServiceCommand
    .command('stop [target]')
    .description('Stop one managed development target')
    .option('--json', 'Print the resulting shared status document', false)
    .action(async (target: string | undefined, options: { json?: boolean }) => {
      await deps.runDevService({
        action: 'stop',
        json: options.json ?? false,
        target: parseDevStartTarget(target)
      })
    })

  devServiceCommand
    .command('status [target]')
    .description('Read shared service state and active operation leases without starting services')
    .option('--json', 'Print the machine-readable shared status document', false)
    .action(async (target: string | undefined, options: { json?: boolean }) => {
      await deps.runDevService({
        action: 'status',
        json: options.json ?? false,
        target: target == null ? undefined : parseDevStartTarget(target)
      })
    })

  for (const action of ['logs', 'events'] as const) {
    devServiceCommand
      .command(`${action} <target>`)
      .description(action === 'logs' ? 'Read a bounded manager log tail' : 'Read bounded service operation events')
      .option(
        '--limit <count>',
        'Maximum number of lines or events',
        value => parsePositiveIntegerOption(value, 'limit'),
        80
      )
      .option('--json', 'Print machine-readable output', false)
      .action(async (target: string, options: { json?: boolean; limit: number }) => {
        await deps.runDevService({
          action,
          json: options.json ?? false,
          limit: options.limit,
          target: parseDevStartTarget(target)
        })
      })
  }

  const adapterE2ECommand = program
    .command('adapter-e2e')
    .description('Run adapter end-to-end verification flows')

  adapterE2ECommand
    .command('run [selection]')
    .description('Run a real offline adapter E2E flow by adapter, case id, or all')
    .option('--quiet', 'Do not stream child CLI output', false)
    .option('--no-summary', 'Disable scenario summary output')
    .action(async (target: string | undefined, options: {
      quiet?: boolean
      summary?: boolean
    }) => {
      await deps.runAdapterSuite(parseAdapterE2ESelection(target), {
        passthroughStdIO: !options.quiet,
        printSummary: options.summary ?? true
      })
    })

  adapterE2ECommand
    .command('test [selection]')
    .description('Run the Vitest adapter E2E suite by adapter, case id, or all')
    .option('--verbose', 'Enable verbose child CLI output', false)
    .option('-u, --update', 'Update Vitest file snapshots', false)
    .action(async (selection: string | undefined, options: {
      update?: boolean
      verbose?: boolean
    }) => {
      await deps.runAdapterVitest({
        selection: parseAdapterE2ESelection(selection),
        updateSnapshots: options.update ?? false,
        verbose: options.verbose ?? false
      })
    })

  const desktopControlCommand = program
    .command('desktop-control')
    .description('Create AI-agent control targets for the Electron desktop app')

  desktopControlCommand
    .command('serve')
    .description('Start a local JSON protocol bridge between agents and the Electron app')
    .option('--host <host>', 'Bridge bind host', '127.0.0.1')
    .option(
      '--port <port>',
      'Bridge port; defaults to a free local port',
      value => parseNonNegativeIntegerOption(value, 'port')
    )
    .option('--json', 'Print machine-readable ready payload', true)
    .option('--text', 'Print concise text output instead of JSON', false)
    .action(async (options: {
      host: string
      json?: boolean
      port?: number
      text?: boolean
    }) => {
      await deps.runDesktopControlServe({
        host: options.host,
        json: options.text === true ? false : options.json ?? true,
        port: options.port,
        text: options.text ?? false
      })
    })

  desktopControlCommand
    .command('launch')
    .description('Cold-launch an isolated Electron app instance and return a CDP control endpoint')
    .option(
      '--allow-unsupported-app',
      'Unsafe: bypass the external CDP hook check for legacy Electron apps',
      false
    )
    .option('--app <path>', 'Installed macOS .app path or executable path', DEFAULT_DESKTOP_APP_PATH)
    .option('--executable <path>', 'Explicit executable path; defaults to the executable inside --app')
    .option('--workspace <path>', 'Workspace folder to open on launch')
    .option('--user-data-dir <path>', 'Isolated Electron userData directory; defaults to a temp directory')
    .option('--address <host>', 'CDP bind address', '127.0.0.1')
    .option(
      '--port <port>',
      'CDP port; defaults to a free local port',
      value => parsePositiveIntegerOption(value, 'port')
    )
    .option(
      '--wait-ms <ms>',
      'How long to wait for the CDP target list',
      value => parsePositiveIntegerOption(value, 'wait-ms'),
      30_000
    )
    .option('--json', 'Print machine-readable JSON', true)
    .option('--text', 'Print concise text output instead of JSON', false)
    .action(async (options: {
      address: string
      allowUnsupportedApp?: boolean
      app: string
      executable?: string
      json?: boolean
      port?: number
      text?: boolean
      userDataDir?: string
      waitMs: number
      workspace?: string
    }) => {
      const json = options.text === true ? false : options.json ?? true
      try {
        await deps.runDesktopCdpLaunch({
          address: options.address,
          allowUnsupportedApp: options.allowUnsupportedApp ?? false,
          appPath: options.app,
          executable: options.executable,
          json,
          port: options.port,
          userDataDir: options.userDataDir,
          waitMs: options.waitMs,
          workspace: options.workspace
        })
      } catch (error) {
        if (json && isStructuredCliError(error)) {
          writeStructuredCliError(error)
          return
        }
        throw error
      }
    })

  desktopControlCommand
    .command('record-batch <scenario>')
    .description('Record light/dark x zh/en variants through real Electron sessions')
    .option(
      '--allow-unsupported-app',
      'Unsafe: bypass the external CDP hook check for legacy Electron apps',
      false
    )
    .option('--app <path>', 'Installed macOS .app path or executable path', DEFAULT_DESKTOP_APP_PATH)
    .option('--executable <path>', 'Explicit executable path; defaults to the executable inside --app')
    .option('--workspace <path>', 'Workspace folder for launcher/workspace scenarios')
    .option('--out-dir <path>', 'Output root directory')
    .option('--name <name>', 'Output file basename prefix')
    .option('--ffmpeg-path <path>', 'ffmpeg executable path', 'ffmpeg')
    .option('--use-deskpad-display', 'Place Electron recording windows on the DeskPad Display virtual desktop', false)
    .option(
      '--recording-display-name <name>',
      'macOS display name used for recording window bounds; defaults to DeskPad Display with --use-deskpad-display'
    )
    .option('--fps <fps>', 'Recording frame rate', value => parsePositiveIntegerOption(value, 'fps'))
    .option(
      '--duration-ms <ms>',
      'Scenario-controlled recording duration',
      value => parsePositiveIntegerOption(value, 'duration-ms')
    )
    .option(
      '--wait-ms <ms>',
      'How long to wait for each Electron CDP target list',
      value => parsePositiveIntegerOption(value, 'wait-ms'),
      30_000
    )
    .option('--video-background-image <path>', 'Approved wallpaper image for the recording display background')
    .option(
      '--color-schemes <list>',
      'Comma-separated color schemes, for example light,dark',
      value => parseDemoVideoColorSchemeList(value)
    )
    .option(
      '--languages <list>',
      'Comma-separated interface languages, for example zh,en',
      value => parseDemoVideoLanguageList(value)
    )
    .option('--keep-frames', 'Keep raw PNG frames next to the MP4', false)
    .option('--json', 'Print machine-readable JSON', false)
    .action(async (scenarioId: string, options: {
      allowUnsupportedApp?: boolean
      app: string
      colorSchemes?: DemoVideoColorScheme[]
      durationMs?: number
      executable?: string
      ffmpegPath?: string
      fps?: number
      json?: boolean
      keepFrames?: boolean
      languages?: string[]
      name?: string
      outDir?: string
      recordingDisplayName?: string
      useDeskpadDisplay?: boolean
      videoBackgroundImage?: string
      waitMs: number
      workspace?: string
    }) => {
      await deps.runDesktopControlRecordBatch({
        allowUnsupportedApp: options.allowUnsupportedApp ?? false,
        appPath: options.app,
        colorSchemes: options.colorSchemes,
        durationMs: options.durationMs,
        executable: options.executable,
        ffmpegPath: options.ffmpegPath,
        fps: options.fps,
        json: options.json ?? false,
        keepFrames: options.keepFrames ?? false,
        languages: options.languages,
        name: options.name,
        outDir: options.outDir,
        recordingDisplayName: options.recordingDisplayName,
        scenarioId,
        useDeskpadDisplay: options.useDeskpadDisplay ?? false,
        videoBackgroundImage: options.videoBackgroundImage,
        waitMs: options.waitMs,
        workspace: options.workspace
      })
    })

  const chromeDebugCommand = program
    .command('chrome-debug')
    .description('Inspect and drive a locally running Chrome DevTools target')

  chromeDebugCommand
    .command('targets')
    .description('List Chrome DevTools targets on a local debugging port')
    .option('--port <port>', 'Chrome remote debugging port', value => parsePositiveIntegerOption(value, 'port'), 9222)
    .option('--json', 'Print targets as JSON', false)
    .action(async (options: {
      json?: boolean
      port: number
    }) => {
      await deps.runChromeDebugTargets({
        port: options.port,
        json: options.json ?? false
      })
    })

  chromeDebugCommand
    .command('messenger-conversations')
    .description('List visible Feishu messenger conversations on the current page')
    .option('--port <port>', 'Chrome remote debugging port', value => parsePositiveIntegerOption(value, 'port'), 9222)
    .option(
      '--page-url-substring <substring>',
      'Match the messenger page by URL substring',
      getDefaultChromeDebugPageUrlSubstring()
    )
    .action(async (options: {
      pageUrlSubstring: string
      port: number
    }) => {
      await deps.runChromeDebugMessengerConversations({
        port: options.port,
        pageUrlSubstring: options.pageUrlSubstring
      })
    })

  chromeDebugCommand
    .command('messenger-send <conversation> <message>')
    .description('Open a Feishu messenger conversation and send a message')
    .option('--port <port>', 'Chrome remote debugging port', value => parsePositiveIntegerOption(value, 'port'), 9222)
    .option(
      '--page-url-substring <substring>',
      'Match the messenger page by URL substring',
      getDefaultChromeDebugPageUrlSubstring()
    )
    .option('--replace-draft', 'Replace any existing draft text in the composer', false)
    .option(
      '--settle-ms <ms>',
      'Wait time after clicking send',
      value => parsePositiveIntegerOption(value, 'settle-ms'),
      1500
    )
    .action(async (conversation: string, message: string, options: {
      pageUrlSubstring: string
      port: number
      replaceDraft?: boolean
      settleMs: number
    }) => {
      await deps.runChromeDebugMessengerSend({
        port: options.port,
        pageUrlSubstring: options.pageUrlSubstring,
        conversation,
        message,
        replaceDraft: options.replaceDraft ?? false,
        settleMs: options.settleMs
      })
    })

  chromeDebugCommand
    .command('messenger-click-reply <conversation> <messageSnippet>')
    .description('Hover a Feishu message bubble and click its reply action')
    .option('--port <port>', 'Chrome remote debugging port', value => parsePositiveIntegerOption(value, 'port'), 9222)
    .option(
      '--page-url-substring <substring>',
      'Match the messenger page by URL substring',
      getDefaultChromeDebugPageUrlSubstring()
    )
    .option(
      '--reply-index <index>',
      'Pick the nth visible reply button near the hovered bubble',
      value => parsePositiveIntegerOption(value, 'reply-index'),
      1
    )
    .option(
      '--settle-ms <ms>',
      'Wait time after clicking reply',
      value => parsePositiveIntegerOption(value, 'settle-ms'),
      1000
    )
    .action(async (conversation: string, messageSnippet: string, options: {
      pageUrlSubstring: string
      port: number
      replyIndex: number
      settleMs: number
    }) => {
      await deps.runChromeDebugMessengerClickReply({
        port: options.port,
        pageUrlSubstring: options.pageUrlSubstring,
        conversation,
        messageSnippet,
        replyIndex: options.replyIndex,
        settleMs: options.settleMs
      })
    })

  chromeDebugCommand
    .command('messenger-click-text <conversation> <text>')
    .description('Click a visible messenger UI element by exact text')
    .option('--port <port>', 'Chrome remote debugging port', value => parsePositiveIntegerOption(value, 'port'), 9222)
    .option(
      '--page-url-substring <substring>',
      'Match the messenger page by URL substring',
      getDefaultChromeDebugPageUrlSubstring()
    )
    .option(
      '--settle-ms <ms>',
      'Wait time after clicking the text target',
      value => parsePositiveIntegerOption(value, 'settle-ms'),
      1000
    )
    .action(async (conversation: string, text: string, options: {
      pageUrlSubstring: string
      port: number
      settleMs: number
    }) => {
      await deps.runChromeDebugMessengerClickText({
        port: options.port,
        pageUrlSubstring: options.pageUrlSubstring,
        conversation,
        text,
        settleMs: options.settleMs
      })
    })

  const messageActionsCommand = program
    .command('message-actions')
    .description('Run reusable verification flows for message-level chat actions')

  messageActionsCommand
    .command('verify')
    .description('Run code-quality and regression checks for message edit/recall/fork changes')
    .option('--quiet', 'Do not stream child command output', false)
    .action(async (options: {
      quiet?: boolean
    }) => {
      await deps.runMessageActionsVerify({
        quiet: options.quiet ?? false
      })
    })

  const demoVideoCommand = program
    .command('demo-video')
    .description('Record reusable product capability demo videos')

  demoVideoCommand
    .command('list')
    .description('List available demo video scenarios')
    .option('--json', 'Print machine-readable JSON', false)
    .action(async (options: {
      json?: boolean
    }) => {
      await deps.runDemoVideoList({
        json: options.json ?? false
      })
    })

  demoVideoCommand
    .command('record <scenario>')
    .description('Record a demo video scenario with isolated Chrome and ffmpeg')
    .option('--url <url>', 'Prepared page URL or service base URL for the scenario')
    .option('--out-dir <path>', 'Output directory')
    .option('--name <name>', 'Output file basename')
    .option('--width <px>', 'Viewport width', value => parsePositiveIntegerOption(value, 'width'))
    .option('--height <px>', 'Viewport height', value => parsePositiveIntegerOption(value, 'height'))
    .option('--fps <fps>', 'Recording frame rate', value => parsePositiveIntegerOption(value, 'fps'))
    .option(
      '--duration-ms <ms>',
      'Scenario-controlled recording duration for generic scenarios',
      value => parsePositiveIntegerOption(value, 'duration-ms')
    )
    .option(
      '--capture-source <source>',
      'Capture source: cdp, system-window, or system-display',
      value => parseDemoVideoCaptureSource(value)
    )
    .option(
      '--system-display-id <id>',
      'macOS display id for system-display capture',
      value => parsePositiveIntegerOption(value, 'system-display-id')
    )
    .option('--workspace <path>', 'Workspace path for scenarios that open a desktop workspace')
    .option('--chrome-path <path>', 'Chrome executable path')
    .option('--ffmpeg-path <path>', 'ffmpeg executable path', 'ffmpeg')
    .option('--headed', 'Launch Chrome with a visible browser window instead of headless mode', false)
    .option(
      '--video-background-color <hex>',
      'Matte color for transparent system-window video regions, for example #323232',
      value => parseDemoVideoBackgroundColor(value)
    )
    .option('--video-background-image <path>', 'Image path for transparent system-window video regions')
    .option(
      '--system-window-capture-backend <backend>',
      'system-window backend: video for continuous local recording, frames for slower alpha PNG capture',
      value => parseDemoVideoSystemWindowCaptureBackend(value)
    )
    .option(
      '--color-scheme <scheme>',
      'Emulated prefers-color-scheme: light, dark, or system',
      value => parseDemoVideoColorScheme(value),
      'light' as DemoVideoColorScheme
    )
    .option(
      '--language <language>',
      'Interface language override, for example zh, en, zh-Hans, or en-US',
      value => parseDemoVideoLanguage(value)
    )
    .option(
      '--page-background <background>',
      'Page background behind the app: app or macos-wallpaper',
      value => parseDemoVideoPageBackground(value)
    )
    .option('--page-background-image <path>', 'Explicit image path for the page background')
    .option('--keep-frames', 'Keep raw PNG frames next to the MP4', false)
    .option('--wait-for-text <text>', 'Wait for visible text before capturing the first frame')
    .option('--wait-for-text-absent <text>', 'Wait for text to disappear before capturing the first frame')
    .option(
      '--wait-for-text-absent-timeout-ms <ms>',
      'Timeout for --wait-for-text-absent',
      value => parsePositiveIntegerOption(value, 'wait-for-text-absent-timeout-ms')
    )
    .option(
      '--wait-for-text-timeout-ms <ms>',
      'Timeout for --wait-for-text',
      value => parsePositiveIntegerOption(value, 'wait-for-text-timeout-ms')
    )
    .option('--json', 'Print machine-readable JSON', false)
    .action(async (scenarioId: string, options: {
      captureSource?: DemoVideoCaptureSource
      chromePath?: string
      colorScheme: DemoVideoColorScheme
      durationMs?: number
      ffmpegPath?: string
      fps?: number
      height?: number
      headed?: boolean
      json?: boolean
      keepFrames?: boolean
      language?: string
      name?: string
      outDir?: string
      pageBackground?: DemoVideoPageBackground
      pageBackgroundImage?: string
      systemDisplayId?: number
      systemWindowCaptureBackend?: DemoVideoSystemWindowCaptureBackend
      url?: string
      videoBackgroundColor?: string
      videoBackgroundImage?: string
      waitForText?: string
      waitForTextAbsent?: string
      waitForTextAbsentTimeoutMs?: number
      waitForTextTimeoutMs?: number
      workspace?: string
      width?: number
    }) => {
      await deps.runDemoVideoRecord({
        scenarioId,
        captureSource: options.captureSource,
        chromePath: options.chromePath,
        colorScheme: options.colorScheme,
        durationMs: options.durationMs,
        ffmpegPath: options.ffmpegPath,
        fps: options.fps,
        height: options.height,
        headless: options.headed !== true,
        json: options.json ?? false,
        keepFrames: options.keepFrames ?? false,
        language: options.language,
        name: options.name,
        outDir: options.outDir,
        pageBackground: options.pageBackground,
        pageBackgroundImage: options.pageBackgroundImage,
        systemDisplayId: options.systemDisplayId,
        systemWindowCaptureBackend: options.systemWindowCaptureBackend,
        url: options.url,
        videoBackgroundColor: options.videoBackgroundColor,
        videoBackgroundImage: options.videoBackgroundImage,
        waitForText: options.waitForText,
        waitForTextAbsent: options.waitForTextAbsent,
        waitForTextAbsentTimeoutMs: options.waitForTextAbsentTimeoutMs,
        waitForTextTimeoutMs: options.waitForTextTimeoutMs,
        workspace: options.workspace,
        width: options.width
      })
    })

  demoVideoCommand
    .command('batch <scenario>')
    .description('Record demo video variants, defaulting to light/dark x zh/en')
    .option('--url <url>', 'Prepared page URL or service base URL for the scenario')
    .option('--out-dir <path>', 'Output root directory')
    .option('--name <name>', 'Output file basename prefix')
    .option('--width <px>', 'Viewport width', value => parsePositiveIntegerOption(value, 'width'))
    .option('--height <px>', 'Viewport height', value => parsePositiveIntegerOption(value, 'height'))
    .option('--fps <fps>', 'Recording frame rate', value => parsePositiveIntegerOption(value, 'fps'))
    .option(
      '--duration-ms <ms>',
      'Scenario-controlled recording duration for generic scenarios',
      value => parsePositiveIntegerOption(value, 'duration-ms')
    )
    .option(
      '--capture-source <source>',
      'Capture source: cdp, system-window, or system-display',
      value => parseDemoVideoCaptureSource(value)
    )
    .option(
      '--system-display-id <id>',
      'macOS display id for system-display capture',
      value => parsePositiveIntegerOption(value, 'system-display-id')
    )
    .option('--workspace <path>', 'Workspace path for scenarios that open a desktop workspace')
    .option('--chrome-path <path>', 'Chrome executable path')
    .option('--ffmpeg-path <path>', 'ffmpeg executable path', 'ffmpeg')
    .option('--headed', 'Launch Chrome with a visible browser window instead of headless mode', false)
    .option(
      '--video-background-color <hex>',
      'Matte color for transparent system-window video regions, for example #323232',
      value => parseDemoVideoBackgroundColor(value)
    )
    .option('--video-background-image <path>', 'Image path for transparent system-window video regions')
    .option(
      '--system-window-capture-backend <backend>',
      'system-window backend: video for continuous local recording, frames for slower alpha PNG capture',
      value => parseDemoVideoSystemWindowCaptureBackend(value)
    )
    .option(
      '--color-schemes <list>',
      'Comma-separated color schemes, for example light,dark',
      value => parseDemoVideoColorSchemeList(value)
    )
    .option(
      '--languages <list>',
      'Comma-separated interface languages, for example zh,en',
      value => parseDemoVideoLanguageList(value)
    )
    .option(
      '--page-background <background>',
      'Page background behind the app: app or macos-wallpaper',
      value => parseDemoVideoPageBackground(value)
    )
    .option('--page-background-image <path>', 'Explicit image path for the page background')
    .option('--keep-frames', 'Keep raw PNG frames next to the MP4', false)
    .option('--wait-for-text <text>', 'Wait for visible text before capturing the first frame')
    .option('--wait-for-text-absent <text>', 'Wait for text to disappear before capturing the first frame')
    .option(
      '--wait-for-text-absent-timeout-ms <ms>',
      'Timeout for --wait-for-text-absent',
      value => parsePositiveIntegerOption(value, 'wait-for-text-absent-timeout-ms')
    )
    .option(
      '--wait-for-text-timeout-ms <ms>',
      'Timeout for --wait-for-text',
      value => parsePositiveIntegerOption(value, 'wait-for-text-timeout-ms')
    )
    .option('--json', 'Print machine-readable JSON', false)
    .action(async (scenarioId: string, options: {
      captureSource?: DemoVideoCaptureSource
      chromePath?: string
      colorSchemes?: DemoVideoColorScheme[]
      durationMs?: number
      ffmpegPath?: string
      fps?: number
      height?: number
      headed?: boolean
      json?: boolean
      keepFrames?: boolean
      languages?: string[]
      name?: string
      outDir?: string
      pageBackground?: DemoVideoPageBackground
      pageBackgroundImage?: string
      systemDisplayId?: number
      systemWindowCaptureBackend?: DemoVideoSystemWindowCaptureBackend
      url?: string
      videoBackgroundColor?: string
      videoBackgroundImage?: string
      waitForText?: string
      waitForTextAbsent?: string
      waitForTextAbsentTimeoutMs?: number
      waitForTextTimeoutMs?: number
      workspace?: string
      width?: number
    }) => {
      await deps.runDemoVideoBatch({
        scenarioId,
        captureSource: options.captureSource,
        chromePath: options.chromePath,
        colorSchemes: options.colorSchemes,
        durationMs: options.durationMs,
        ffmpegPath: options.ffmpegPath,
        fps: options.fps,
        height: options.height,
        headless: options.headed !== true,
        json: options.json ?? false,
        keepFrames: options.keepFrames ?? false,
        languages: options.languages,
        name: options.name,
        outDir: options.outDir,
        pageBackground: options.pageBackground,
        pageBackgroundImage: options.pageBackgroundImage,
        systemDisplayId: options.systemDisplayId,
        systemWindowCaptureBackend: options.systemWindowCaptureBackend,
        url: options.url,
        videoBackgroundColor: options.videoBackgroundColor,
        videoBackgroundImage: options.videoBackgroundImage,
        waitForText: options.waitForText,
        waitForTextAbsent: options.waitForTextAbsent,
        waitForTextAbsentTimeoutMs: options.waitForTextAbsentTimeoutMs,
        waitForTextTimeoutMs: options.waitForTextTimeoutMs,
        workspace: options.workspace,
        width: options.width
      })
    })

  const agentRoomSmokeCommand = program
    .command('agent-room-smoke')
    .description('Run reusable verification flows for agent rooms')

  agentRoomSmokeCommand
    .command('resume')
    .description('Run a real StartTasks -> room message -> task resume smoke')
    .option('--json', 'Print machine-readable JSON', false)
    .action(async (options: {
      json?: boolean
    }) => {
      await deps.runAgentRoomResumeSmoke({
        json: options.json ?? false
      })
    })

  const relayConfigCommand = program
    .command('relay-config')
    .description('Run reusable Relay managed config verification flows')

  relayConfigCommand
    .command('smoke')
    .description('Run a real @oneworks/plugin-relay ./config -> loadConfigState smoke')
    .option('--allow-pending', 'Exit successfully while the final Relay config hook API is still pending', false)
    .option('--json', 'Print machine-readable JSON', false)
    .option('--keep-temp', 'Keep the temporary smoke workspace for debugging', false)
    .action(async (options: {
      allowPending?: boolean
      json?: boolean
      keepTemp?: boolean
    }) => {
      await deps.runRelayConfigSmoke({
        allowPending: options.allowPending ?? false,
        json: options.json ?? false,
        keepTemp: options.keepTemp ?? false
      })
    })

  relayConfigCommand
    .command('live-smoke')
    .description('Run a real Relay Server/Admin/team config live smoke')
    .option('--json', 'Print machine-readable JSON', false)
    .option('--keep-temp', 'Keep the temporary smoke workspace for debugging', false)
    .option('--skip-admin-build', 'Reuse existing relay-admin dist assets', false)
    .action(async (options: {
      json?: boolean
      keepTemp?: boolean
      skipAdminBuild?: boolean
    }) => {
      await deps.runRelayConfigLiveSmoke({
        json: options.json ?? false,
        keepTemp: options.keepTemp ?? false,
        skipAdminBuild: options.skipAdminBuild ?? false
      })
    })

  program
    .command('relay-auth-fixture [command]')
    .description('Switch local Relay account auth fixtures for UI debugging')
    .option('--json', 'Print machine-readable JSON', false)
    .addHelpText(
      'after',
      '\nCommands:\n' +
        '  single-user               one account on one server\n' +
        '  single-server-multi-user  multiple accounts on one server\n' +
        '  multi-server-multi-user   multiple accounts across multiple servers (default)\n' +
        '  restore                   restore the auth.json backup captured before fixture writes\n' +
        '  path                      print auth.json and backup paths\n'
    )
    .action(async (command: string | undefined, options: {
      json?: boolean
    }) => {
      await deps.runRelayAuthFixture({
        command: parseRelayAuthFixtureCommand(command),
        json: options.json ?? false
      })
    })

  program
    .command('commitmsg-check [base] [head]')
    .description('Validate commit subjects in a git revision range')
    .action(async (base: string | undefined, head: string | undefined) => {
      await deps.runCommitMessageCheck({
        base,
        head
      })
    })

  program
    .command('pr-change-check [base] [head]')
    .description('Validate PR changelog and screenshot requirements')
    .option('--body <markdown>', 'Pull request body markdown')
    .option('--body-file <path>', 'File containing the pull request body markdown')
    .action(async (base: string | undefined, head: string | undefined, options: {
      body?: string
      bodyFile?: string
    }) => {
      await deps.runPrChangeCheck({
        base,
        head,
        body: options.body,
        bodyFile: options.bodyFile
      })
    })

  program
    .command('publish-plan [args...]')
    .allowUnknownOption()
    .description('Run the publish plan tool with passthrough arguments')
    .action(async (args: string[] = []) => {
      await deps.runPublishPlan(args)
    })

  const releaseTagsCommand = program
    .command('release-tags')
    .description('Plan release tags from workspace package version changes')

  releaseTagsCommand
    .command('plan <base> <head>')
    .description('Print pkg/<package>/v<version> tags needed for package version changes')
    .option('--json', 'Print machine-readable JSON', false)
    .action(async (base: string, head: string, options: {
      json?: boolean
    }) => {
      await deps.runReleaseTagsPlan({
        base,
        head,
        json: options.json ?? false
      })
    })

  const runtimeEvidenceCommand = program
    .command('runtime-evidence')
    .description('Inspect runtime session events as reusable UI/agent evidence')

  runtimeEvidenceCommand
    .command('list')
    .option('--home <path>', 'Real HOME containing .oneworks/projects')
    .option('--project-home <path>', 'Project home to inspect before bounded home discovery')
    .option(
      '--limit <count>',
      'Maximum sessions to print',
      value => parsePositiveIntegerOption(value, 'limit'),
      50
    )
    .option('--json', 'Print machine-readable JSON', false)
    .description('List bounded runtime session event files and their last assistant/completion state')
    .action(async (options: {
      home?: string
      json?: boolean
      limit: number
      projectHome?: string
    }) => {
      await deps.runRuntimeEvidenceList({
        homeDir: options.home,
        limit: options.limit,
        projectHome: options.projectHome,
        json: options.json ?? false
      })
    })

  runtimeEvidenceCommand
    .command('wait-reply')
    .option('--expected-reply <text>', 'Assistant reply text or substring to wait for')
    .option('--session-id <id>', 'Optional session id; omitted means bounded discovery by expected reply')
    .option('--home <path>', 'Real HOME containing .oneworks/projects')
    .option('--project-home <path>', 'Project home to inspect before bounded home discovery')
    .option(
      '--wait-ms <ms>',
      'How long to poll events.jsonl',
      value => parsePositiveIntegerOption(value, 'wait-ms'),
      60_000
    )
    .option('--json', 'Print machine-readable JSON', false)
    .description('Wait for a completed runtime session reply, optionally discovering the session by nonce')
    .action(async (options: {
      expectedReply?: string
      home?: string
      json?: boolean
      projectHome?: string
      sessionId?: string
      waitMs: number
    }) => {
      await deps.runRuntimeEvidenceWait({
        expectedReply: options.expectedReply,
        homeDir: options.home,
        projectHome: options.projectHome,
        sessionId: options.sessionId,
        waitMs: options.waitMs,
        json: options.json ?? false
      })
    })

  const releaseVerifyCommand = program
    .command('release-verify')
    .description('Run reusable post-publish release verification checks')

  releaseVerifyCommand
    .command('agent')
    .option('--channel <tag>', 'Release channel / npm dist-tag to verify', 'beta')
    .option('--version <version>', 'Expected version, or auto to resolve from oneworks@channel', 'auto')
    .option(
      '--scenario <name>',
      'Verification scenario: desktop-installed or desktop-chat',
      value => parseReleaseVerifyScenario(value),
      'desktop-chat'
    )
    .option('--repo <repo>', 'GitHub repository for desktop releases', DEFAULT_RELEASE_VERIFY_REPO)
    .option('--no-desktop-release', 'Skip GitHub desktop release asset checks')
    .option('--skip-desktop-app', 'Skip installed desktop app bundle checks', false)
    .option('--desktop-app <path>', 'Installed macOS app path', DEFAULT_DESKTOP_APP_PATH)
    .option('--desktop-bundle-id <id>', 'Expected installed app bundle id', DEFAULT_DESKTOP_BUNDLE_ID)
    .option('--no-runtime-cache', 'Skip bootstrap runtime cache package checks')
    .option('--runtime-cache-home <path>', 'Real HOME that owns .oneworks/bootstrap and runtime stores')
    .option('--package-cache-root <path>', 'Explicit .oneworks/bootstrap cache root')
    .option('--session-id <id>', 'Optional runtime session id; omitted means discover by expected reply')
    .option('--expected-reply <text>', 'Expected assistant reply text; defaults to a generated nonce')
    .option('--project-home <path>', 'Optional project home to narrow runtime session discovery')
    .option(
      '--wait-session-ms <ms>',
      'How long to poll events.jsonl for session completion',
      value => parsePositiveIntegerOption(value, 'wait-session-ms'),
      90_000
    )
    .option('--json', 'Print machine-readable JSON', false)
    .description('Agent-first release verification: print a UI task, discover chat evidence, and report diagnosis')
    .action(async (options: {
      channel: string
      desktopApp: string
      desktopBundleId: string
      desktopRelease?: boolean
      expectedReply?: string
      json?: boolean
      packageCacheRoot?: string
      projectHome?: string
      repo: string
      runtimeCache?: boolean
      runtimeCacheHome?: string
      scenario: ReturnType<typeof parseReleaseVerifyScenario>
      sessionId?: string
      skipDesktopApp?: boolean
      version: string
      waitSessionMs: number
    }) => {
      await deps.runReleaseVerifyAgent({
        channel: options.channel,
        version: options.version,
        scenario: options.scenario,
        repo: options.repo,
        desktopRelease: options.desktopRelease ?? true,
        desktopApp: !(options.skipDesktopApp ?? false),
        desktopAppPath: options.desktopApp,
        desktopBundleId: options.desktopBundleId,
        runtimeCache: options.runtimeCache ?? true,
        runtimeCacheHome: options.runtimeCacheHome,
        packageCacheRoot: options.packageCacheRoot,
        sessionId: options.sessionId,
        expectedReply: options.expectedReply,
        projectHome: options.projectHome,
        waitSessionMs: options.waitSessionMs,
        json: options.json ?? false
      })
    })

  releaseVerifyCommand
    .command('run')
    .option('--channel <tag>', 'Release channel / npm dist-tag to verify', 'beta')
    .option('--version <version>', 'Expected version, or auto to resolve from oneworks@channel', 'auto')
    .option(
      '--scenario <name>',
      'Verification scenario: desktop-installed or desktop-chat',
      value => parseReleaseVerifyScenario(value),
      'desktop-installed'
    )
    .option('--repo <repo>', 'GitHub repository for desktop releases', DEFAULT_RELEASE_VERIFY_REPO)
    .option(
      '--npm-packages <list>',
      'Comma-separated npm packages that must resolve from the selected dist-tag',
      value => parseReleaseVerifyList(value),
      DEFAULT_RELEASE_VERIFY_NPM_PACKAGES
    )
    .option(
      '--runtime-packages <list>',
      'Comma-separated runtime packages to verify in the app bundle and bootstrap cache',
      value => parseReleaseVerifyList(value),
      DEFAULT_RELEASE_VERIFY_RUNTIME_PACKAGES
    )
    .option('--no-desktop-release', 'Skip GitHub desktop release asset checks')
    .option('--skip-desktop-app', 'Skip installed desktop app bundle checks', false)
    .option('--desktop-app <path>', 'Installed macOS app path', DEFAULT_DESKTOP_APP_PATH)
    .option('--desktop-bundle-id <id>', 'Expected installed app bundle id', DEFAULT_DESKTOP_BUNDLE_ID)
    .option('--allow-build-source', 'Allow desktop-build-source.json in the installed app', false)
    .option('--no-runtime-cache', 'Skip bootstrap runtime cache package checks')
    .option(
      '--runtime-exact-version',
      'Require runtime packages to equal --version instead of each package@channel',
      false
    )
    .option('--runtime-cache-home <path>', 'Real HOME that owns .oneworks/bootstrap')
    .option('--package-cache-root <path>', 'Explicit .oneworks/bootstrap cache root')
    .option('--session-id <id>', 'Runtime session id created by the UI send flow')
    .option('--expected-reply <text>', 'Expected assistant reply text or substring')
    .option('--project-home <path>', 'Project home that owns runtime/sessions/<id>/events.jsonl')
    .option(
      '--wait-session-ms <ms>',
      'How long to poll events.jsonl for session completion',
      value => parsePositiveIntegerOption(value, 'wait-session-ms'),
      60_000
    )
    .option('--json', 'Print machine-readable JSON', false)
    .description('AI-oriented release verification runner with auto version discovery and evidence reporting')
    .action(async (options: {
      allowBuildSource?: boolean
      channel: string
      desktopApp: string
      desktopBundleId: string
      desktopRelease?: boolean
      expectedReply?: string
      json?: boolean
      npmPackages: string[]
      packageCacheRoot?: string
      projectHome?: string
      repo: string
      runtimeCache?: boolean
      runtimeCacheHome?: string
      runtimeExactVersion?: boolean
      runtimePackages: string[]
      scenario: ReturnType<typeof parseReleaseVerifyScenario>
      sessionId?: string
      skipDesktopApp?: boolean
      version: string
      waitSessionMs: number
    }) => {
      await deps.runReleaseVerify({
        channel: options.channel,
        version: options.version,
        scenario: options.scenario,
        repo: options.repo,
        npmPackages: options.npmPackages,
        runtimePackages: options.runtimePackages,
        desktopRelease: options.desktopRelease ?? true,
        desktopApp: !(options.skipDesktopApp ?? false),
        desktopAppPath: options.desktopApp,
        desktopBundleId: options.desktopBundleId,
        withoutBuildSource: !(options.allowBuildSource ?? false),
        runtimeCache: options.runtimeCache ?? true,
        runtimeVersionMode: options.runtimeExactVersion ? 'exact' : 'dist-tag',
        runtimeCacheHome: options.runtimeCacheHome,
        packageCacheRoot: options.packageCacheRoot,
        sessionId: options.sessionId,
        expectedReply: options.expectedReply,
        projectHome: options.projectHome,
        waitSessionMs: options.waitSessionMs,
        json: options.json ?? false
      })
    })

  releaseVerifyCommand
    .command('beta')
    .requiredOption('--version <version>', 'Expected beta version, e.g. 0.1.0-beta.4')
    .option('--tag <tag>', 'npm dist-tag to verify', 'beta')
    .option('--repo <repo>', 'GitHub repository for desktop releases', DEFAULT_RELEASE_VERIFY_REPO)
    .option(
      '--npm-packages <list>',
      'Comma-separated npm packages that must resolve from the selected dist-tag',
      value => parseReleaseVerifyList(value),
      DEFAULT_RELEASE_VERIFY_NPM_PACKAGES
    )
    .option(
      '--runtime-packages <list>',
      'Comma-separated runtime packages to verify in the app bundle and bootstrap cache',
      value => parseReleaseVerifyList(value),
      DEFAULT_RELEASE_VERIFY_RUNTIME_PACKAGES
    )
    .option('--no-desktop-release', 'Skip GitHub desktop release asset checks')
    .option(
      '--desktop-assets <list>',
      'Exact desktop release asset names to require',
      value => parseReleaseVerifyList(value)
    )
    .option(
      '--desktop-asset-archs <list>',
      'Desktop release asset archs to require',
      value => parseReleaseVerifyList(value)
    )
    .option(
      '--desktop-asset-exts <list>',
      'Desktop release asset extensions to require',
      value => parseReleaseVerifyList(value)
    )
    .option('--skip-desktop-app', 'Skip installed desktop app bundle checks', false)
    .option('--desktop-app <path>', 'Installed macOS app path', DEFAULT_DESKTOP_APP_PATH)
    .option('--desktop-bundle-id <id>', 'Expected installed app bundle id', DEFAULT_DESKTOP_BUNDLE_ID)
    .option('--desktop-app-name <name>', 'Expected installed app name')
    .option('--allow-build-source', 'Allow desktop-build-source.json in the installed app', false)
    .option('--no-runtime-cache', 'Skip bootstrap runtime cache package checks')
    .option('--runtime-exact-version', 'Require runtime packages to equal --version instead of each package@tag', false)
    .option('--runtime-cache-home <path>', 'Real HOME that owns .oneworks/bootstrap')
    .option('--package-cache-root <path>', 'Explicit .oneworks/bootstrap cache root')
    .option('--session-id <id>', 'Runtime session id created by the UI send flow')
    .option('--expected-reply <text>', 'Expected assistant reply text or substring')
    .option('--project-home <path>', 'Project home that owns runtime/sessions/<id>/events.jsonl')
    .option(
      '--wait-session-ms <ms>',
      'How long to poll events.jsonl for session completion',
      value => parsePositiveIntegerOption(value, 'wait-session-ms'),
      60_000
    )
    .option('--json', 'Print machine-readable JSON', false)
    .description(
      'Verify the published beta npm packages, desktop release, installed app, runtime cache, and optional UI session'
    )
    .action(async (options: {
      allowBuildSource?: boolean
      desktopAppName?: string
      desktopApp: string
      desktopAssets?: string[]
      desktopAssetArchs?: string[]
      desktopAssetExts?: string[]
      desktopBundleId: string
      desktopRelease?: boolean
      expectedReply?: string
      json?: boolean
      npmPackages: string[]
      packageCacheRoot?: string
      projectHome?: string
      repo: string
      runtimeCache?: boolean
      runtimeCacheHome?: string
      runtimeExactVersion?: boolean
      runtimePackages: string[]
      sessionId?: string
      skipDesktopApp?: boolean
      tag: string
      version: string
      waitSessionMs: number
    }) => {
      await deps.runReleaseVerifyBeta({
        version: options.version,
        tag: options.tag,
        repo: options.repo,
        npmPackages: options.npmPackages,
        runtimePackages: options.runtimePackages,
        desktopRelease: options.desktopRelease ?? true,
        desktopAssetNames: options.desktopAssets,
        desktopAssetArchs: options.desktopAssetArchs,
        desktopAssetExts: options.desktopAssetExts,
        desktopApp: !(options.skipDesktopApp ?? false),
        desktopAppPath: options.desktopApp,
        desktopBundleId: options.desktopBundleId,
        desktopAppName: options.desktopAppName,
        withoutBuildSource: !(options.allowBuildSource ?? false),
        runtimeCache: options.runtimeCache ?? true,
        runtimeVersionMode: options.runtimeExactVersion ? 'exact' : 'dist-tag',
        runtimeCacheHome: options.runtimeCacheHome,
        packageCacheRoot: options.packageCacheRoot,
        sessionId: options.sessionId,
        expectedReply: options.expectedReply,
        projectHome: options.projectHome,
        waitSessionMs: options.waitSessionMs,
        json: options.json ?? false
      })
    })

  const homebrewTapCommand = program
    .command('homebrew-tap')
    .description('Maintain the Homebrew tap submodule')

  homebrewTapCommand
    .command('sync-oneworks')
    .requiredOption('--version <version>', 'Published oneworks version to sync')
    .option('--tap-dir <path>', 'Homebrew tap submodule directory', 'infra/homebrew-tap')
    .option('--formula <path>', 'Formula path inside the tap directory', 'Formula/oneworks.rb')
    .option('--dry-run', 'Calculate the update without writing the formula', false)
    .description('Update Formula/oneworks.rb to the published oneworks tarball')
    .action(async (options: {
      dryRun?: boolean
      formula: string
      tapDir: string
      version: string
    }) => {
      await deps.runHomebrewTapSyncOneWorks({
        version: options.version,
        tapDir: options.tapDir,
        formulaPath: options.formula,
        dryRun: options.dryRun ?? false
      })
    })

  const windowsInstallCommand = program
    .command('windows-install')
    .description('Maintain Windows install metadata')

  windowsInstallCommand
    .command('sync-oneworks')
    .requiredOption('--version <version>', 'Published oneworks version to sync')
    .option('--scoop-manifest <path>', 'Scoop manifest path', 'infra/windows/scoop-bucket/bucket/oneworks.json')
    .option(
      '--winget-version-manifest <path>',
      'Winget version manifest path',
      'infra/windows/winget/OneWorks.OneWorks.yaml'
    )
    .option(
      '--winget-locale-manifest <path>',
      'Winget default locale manifest path',
      'infra/windows/winget/OneWorks.OneWorks.locale.en-US.yaml'
    )
    .option(
      '--winget-template <path>',
      'Winget installer manifest template path',
      'infra/windows/winget/OneWorks.OneWorks.installer.template.yaml'
    )
    .option('--winget-installer-url <url>', 'Windows portable zip URL for winget template')
    .option('--winget-installer-sha256 <sha256>', 'Windows portable zip SHA256 for winget template')
    .option('--dry-run', 'Calculate the update without writing files', false)
    .description('Update Scoop and winget Windows install metadata for the oneworks package')
    .action(async (options: {
      dryRun?: boolean
      scoopManifest: string
      version: string
      wingetInstallerSha256?: string
      wingetInstallerUrl?: string
      wingetLocaleManifest: string
      wingetTemplate: string
      wingetVersionManifest: string
    }) => {
      await deps.runWindowsInstallSyncOneWorks({
        version: options.version,
        dryRun: options.dryRun ?? false,
        scoopManifestPath: options.scoopManifest,
        wingetInstallerUrl: options.wingetInstallerUrl,
        wingetInstallerSha256: options.wingetInstallerSha256,
        wingetLocaleManifestPath: options.wingetLocaleManifest,
        wingetVersionManifestPath: options.wingetVersionManifest,
        wingetTemplatePath: options.wingetTemplate
      })
    })

  return program
}

export const runScriptsCli = async (
  argv = process.argv,
  deps: Partial<ScriptsCliDeps> = defaultDeps
) => {
  await createScriptsCli(deps).parseAsync(argv)
}

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
import { parseDemoVideoColorScheme, runDemoVideoList, runDemoVideoRecord } from './demo-video'
import type { DemoVideoColorScheme } from './demo-video'
import type { DevStartTarget } from './dev-start'
import { devStartTargets, parseDevStartTarget, runDevStart as runDevStartCommand } from './dev-start'
import { runHomebrewTapSyncOneWorks } from './homebrew-tap'
import { runMessageActionsVerify } from './message-actions'
import { runPrChangeCheck } from './pr-change-check'
import { runRelayConfigLiveSmoke } from './relay-config-live-smoke'
import { runRelayConfigSmoke } from './relay-config-smoke'
import { runReleaseTagsPlan } from './release-tags'
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
  runChromeDebugTargets: typeof runChromeDebugTargets
  runChromeDebugMessengerConversations: typeof runChromeDebugMessengerConversations
  runChromeDebugMessengerSend: typeof runChromeDebugMessengerSend
  runChromeDebugMessengerClickReply: typeof runChromeDebugMessengerClickReply
  runChromeDebugMessengerClickText: typeof runChromeDebugMessengerClickText
  runDemoVideoList: typeof runDemoVideoList
  runDemoVideoRecord: typeof runDemoVideoRecord
  runMessageActionsVerify: typeof runMessageActionsVerify
  runHomebrewTapSyncOneWorks: typeof runHomebrewTapSyncOneWorks
  runWindowsInstallSyncOneWorks: typeof runWindowsInstallSyncOneWorks
  runPublishPlan: (args: string[]) => Promise<unknown>
  runAgentRoomResumeSmoke: typeof runAgentRoomResumeSmoke
  runRelayConfigLiveSmoke: typeof runRelayConfigLiveSmoke
  runRelayConfigSmoke: typeof runRelayConfigSmoke
  runDevStart: typeof runDevStartCommand
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
  runChromeDebugTargets,
  runChromeDebugMessengerConversations,
  runChromeDebugMessengerSend,
  runChromeDebugMessengerClickReply,
  runChromeDebugMessengerClickText,
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
  runDevStart: runDevStartCommand
}

const devStartTargetDescriptions: Record<DevStartTarget, string> = {
  web: 'server + Vite client',
  electron: 'Electron launcher without binding this repo as a workspace',
  'electron-workspace': 'Electron with the current repo opened as the workspace',
  pwa: 'server + standalone PWA preview',
  homepage: 'Astro homepage with embedded PWA preview',
  docs: 'local markdown docs preview'
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
    .option('--chrome-path <path>', 'Chrome executable path')
    .option('--ffmpeg-path <path>', 'ffmpeg executable path', 'ffmpeg')
    .option(
      '--color-scheme <scheme>',
      'Emulated prefers-color-scheme: light, dark, or system',
      value => parseDemoVideoColorScheme(value),
      'light' as DemoVideoColorScheme
    )
    .option('--keep-frames', 'Keep raw PNG frames next to the MP4', false)
    .option('--json', 'Print machine-readable JSON', false)
    .action(async (scenarioId: string, options: {
      chromePath?: string
      colorScheme: DemoVideoColorScheme
      durationMs?: number
      ffmpegPath?: string
      fps?: number
      height?: number
      json?: boolean
      keepFrames?: boolean
      name?: string
      outDir?: string
      url?: string
      width?: number
    }) => {
      await deps.runDemoVideoRecord({
        scenarioId,
        chromePath: options.chromePath,
        colorScheme: options.colorScheme,
        durationMs: options.durationMs,
        ffmpegPath: options.ffmpegPath,
        fps: options.fps,
        height: options.height,
        json: options.json ?? false,
        keepFrames: options.keepFrames ?? false,
        name: options.name,
        outDir: options.outDir,
        url: options.url,
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

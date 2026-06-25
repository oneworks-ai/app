import { readFile } from 'node:fs/promises'
import process from 'node:process'

import { Option } from 'commander'
import type { Command } from 'commander'

import { generateAdapterQueryOptions, run } from '@oneworks/app-runtime'
import { loadInjectDefaultSystemPromptValue, mergeSystemPrompts } from '@oneworks/config'
import { callHook, prewarmPersistentHookWorker } from '@oneworks/hooks'
import type { RuntimeSessionCommandEnvelope } from '@oneworks/runtime-protocol'
import type { AdapterInteractionRequest, AdapterOutputEvent, SessionInitInfo } from '@oneworks/types'
import { createStartupProfiler, mergeProcessEnvWithProjectEnv, nowStartupMs } from '@oneworks/utils'
import { getCache } from '@oneworks/utils/cache'
import { resolveProjectPrimaryWorkspaceFolder } from '@oneworks/utils/project-cache-path'
import { uuid } from '@oneworks/utils/uuid'

import { getCliDefaultSkillNames, getCliDefaultSkillPluginConfig } from '#~/default-skill-plugin.js'
import {
  clearCliSessionControl,
  formatResumeCommand,
  isCliSessionStopActive,
  readCliSessionControl,
  resolveCliSession,
  resolveCliSessionAdapter,
  writeCliSessionRecord
} from '#~/session-cache.js'
import {
  clearCliSessionPermissionRecovery,
  readCliSessionPermissionRecovery,
  writeCliSessionPermissionRecovery
} from '#~/session-permission-cache.js'
import { resolveCliWorkspaceCwd } from '#~/workspace.js'
import { createAdapterOption, parseCliAdapterOptionValue } from '../@core/adapter-option'
import { extraOptions } from '../@core/extra-options'
import { readRuntimeCommands } from '../agent/runtime-store'
import { applyAdapterCliVersionEnv, persistAdapterCliVersionSelection } from './adapter-cli-version'
import { attachInputBridge } from './input-bridge'
import { supportsRuntimeInteractionResponses } from './input-control'
import { readCliPermissionDecision } from './input-decision'
import {
  getDisallowedResumeFlags,
  getOutputFormat,
  mergeListConfig,
  resolveDefaultOneworksMcpServerOption,
  resolveInjectDefaultSystemPromptOption,
  resolvePermissionModeOption,
  resolveResumeAdapterOptions,
  resolveRunMode
} from './options'
import { getAdapterInteractionMessage, handlePrintEvent, shouldPrintResumeHint } from './output'
import {
  isTerminalPermissionDecision,
  shouldApplyPermissionDecision,
  shouldClearPermissionRecoveryCache
} from './permission-decision'
import {
  PERMISSION_DECISION_CANCEL,
  PERMISSION_RECOVERY_CONTINUE_PROMPT,
  buildPermissionRecoveryRecord,
  extractPermissionErrorContext,
  rememberPermissionToolUses,
  resolvePermissionInteractionDecision
} from './permission-recovery'
import { applyCliPermissionDecision } from './permission-state'
import { createPrintIdleTimeoutController, parsePrintIdleTimeoutSeconds } from './print-idle-timeout'
import { executeRuntimeProtocolCommand } from './protocol'
import { runRuntimeProtocolStdio } from './protocol-stdio'
import { attachRuntimeCommandBridge } from './runtime-command-bridge'
import { createCliRuntimeEventSink, createRuntimeEventSink } from './runtime-event-sink'
import { createSessionExitController } from './session-exit-controller'
import type { ActiveCliSessionRecord, ExitControllableSession, RunOptions } from './types'
import { RUN_INPUT_FORMATS, RUN_OUTPUT_FORMATS } from './types'

type PrintInputCapableSession = ExitControllableSession & {
  pid?: number
  respondInteraction?: (id: string, data: string | string[]) => void | Promise<void>
}

const ADAPTER_CLI_PREPARE_OPERATION_ID = 'adapter-cli-prepare'
const ADAPTER_CLI_PREPARE_OPERATION_TITLE = 'Adapter CLI'
const ADAPTER_CLI_PREPARE_STARTED_MESSAGE =
  'Preparing adapter CLI. If no compatible system installation is available, One Works will install it now.'
const ADAPTER_CLI_PREPARE_COMPLETED_MESSAGE = 'Adapter CLI is ready.'
const ADAPTER_CLI_PREPARE_FAILED_MESSAGE = 'Adapter CLI preparation failed.'

const resolveRunPrimaryWorkspaceFolder = (
  workspaceFolder: string,
  fallbackWorkspaceFolder: string
) =>
  resolveProjectPrimaryWorkspaceFolder(
    workspaceFolder,
    mergeProcessEnvWithProjectEnv(undefined, { workspaceFolder })
  ) ?? fallbackWorkspaceFolder

const writeRuntimeResumeFallbackResult = (params: {
  result: Awaited<ReturnType<typeof executeRuntimeProtocolCommand>>
  outputFormat: RunOptions['outputFormat']
}) => {
  if (params.outputFormat === 'json') {
    console.log(JSON.stringify(params.result, null, 2))
    return
  }
  if (params.outputFormat === 'stream-json') {
    console.log(JSON.stringify(params.result))
    return
  }

  if (params.result.ok) {
    console.log(`Queued runtime resume for session ${params.result.sessionId ?? ''}.`)
    return
  }

  throw new Error(params.result.error ?? 'Failed to queue runtime resume.')
}

const RUNTIME_RESUME_EFFORTS = new Set(['low', 'medium', 'high', 'max'])
const RUNTIME_RESUME_PERMISSION_MODES = new Set(['default', 'acceptEdits', 'plan', 'dontAsk', 'bypassPermissions'])

const toRuntimeResumeEffort = (value: string | undefined): RuntimeSessionCommandEnvelope['effort'] =>
  value != null && RUNTIME_RESUME_EFFORTS.has(value)
    ? value as RuntimeSessionCommandEnvelope['effort']
    : undefined

const toRuntimeResumePermissionMode = (
  value: string | undefined
): RuntimeSessionCommandEnvelope['permissionMode'] =>
  value != null && RUNTIME_RESUME_PERMISSION_MODES.has(value)
    ? value as RuntimeSessionCommandEnvelope['permissionMode']
    : undefined

const readRuntimeSystemPromptFromEnv = async () => {
  const systemPromptFile = process.env.__ONEWORKS_RUNTIME_PROTOCOL_SYSTEM_PROMPT_FILE__?.trim()
  if (systemPromptFile == null || systemPromptFile === '') {
    return undefined
  }
  const content = await readFile(systemPromptFile, 'utf8')
  const trimmed = content.trim()
  return trimmed === '' ? undefined : content
}

const configureRunCommand = (command: Command) => {
  command
    .argument('[description...]')
    .option('--print', 'Print assistant output to stdout', false)
    .addOption(
      new Option('--print-idle-timeout <seconds>', 'Exit print mode if no adapter events are received for N seconds')
        .argParser(parsePrintIdleTimeoutSeconds)
    )
    .option('--model <model>', 'Model to use')
    .option('--effort <effort>', 'Effort to use (low, medium, high, max)')
    .addOption(createAdapterOption('Adapter to use', { allowCliVersion: true }))
    .option('--account <account>', 'Adapter account to use')
    .option('--system-prompt <prompt>', 'System prompt')
    .option(
      '--no-inject-default-system-prompt',
      'Do not inject the default system prompt generated from rules/skills/entities/specs'
    )
    .option('--permission-mode <mode>', 'Permission mode (default, acceptEdits, plan, dontAsk, bypassPermissions)')
    .option('--yolo', 'Shortcut for --permission-mode bypassPermissions', false)
    .option('--session-id <id>', 'Session ID')
    .option('--resume [id]', 'Resume an existing session by session id, or the latest created session when omitted')
    .option('--fork [id]', 'Fork an existing session by session id, or the latest created session when omitted')
    .addOption(
      new Option('--output-format <format>', 'Output format')
        .choices([...RUN_OUTPUT_FORMATS])
        .default('text')
    )
    .addOption(
      new Option('--input-format <format>', 'Input format for print mode stdin control')
        .choices([...RUN_INPUT_FORMATS])
    )
    .option('--spec <spec>', 'Load spec definition')
    .option('--entity <entity>', 'Load entity definition')
    .option('--workspace <workspace>', 'Run in a configured workspace')
    .option('--include-mcp-server <server...>', 'Include MCP server')
    .option('--exclude-mcp-server <server...>', 'Exclude MCP server')
    .option('--no-default-oneworks-mcp-server', 'Do not enable the built-in OneWorks MCP server')
    .option('--include-tool <tool...>', 'Include tool')
    .option('--exclude-tool <tool...>', 'Exclude tool')
    .option('--include-skill <skill...>', 'Include skill')
    .option('--exclude-skill <skill...>', 'Exclude skill')
    .option(
      '--update-skills',
      'Deprecated: runtime skill updates are disabled; use `oneworks skills update` first',
      false
    )
    .addHelpText(
      'after',
      `
Examples:
  oneworks 实现一个新的 list 筛选
  oneworks -A codex --print 读取 README 并总结
  oneworks -A codex@0.130.0 使用指定 Codex CLI 版本，并保存为项目默认
  oneworks -A claude 读取 README 并总结
  oneworks --workspace billing 修复订单状态回滚问题
  oneworks --include-skill oneworks-cli-quickstart 介绍一下 One Works CLI 怎么恢复会话
  oneworks 帮我创建一个前端评审实体
  oneworks 给 frontend-reviewer 加上移动端布局记忆
  oneworks list --view default
  oneworks --resume [sessionId]
  oneworks --fork [sessionId]

Notes:
  --adapter also supports -A, simplified ids like claude / adapter-codex, and <adapter>@<version> for managed native CLI versions.
  --yolo is a shortcut for --permission-mode bypassPermissions.
  When using --resume without a session id, the latest created cached session is resumed.
  When using --fork without a session id, the latest created cached session is used as the fork source.
  When using --resume, startup-only flags like --adapter, --system-prompt, --spec and --workspace are loaded from cache and cannot be set again.
  --permission-mode is the exception: it overrides the cached permission mode for the resumed run and is saved for later resumes.
  Resume still allows overriding --model, --effort, --include-tool and --exclude-tool for the next turn.
  The resolved adapter is pinned in cache, so later default adapter changes do not affect resume.
  Default CLI skills shipped via @oneworks/plugin-cli-skills: ${getCliDefaultSkillNames().join(', ')}.
  In print mode, live permission/input replies require --input-format stream-json, then send {"type":"submit_input","data":"allow_once"}.
`
    )
    .action(async (descriptionArgs: string[], opts: RunOptions, currentCommand: Command) => {
      let runtimeConsumerContext:
        | {
          cwd: string
          sessionId: string
          sink?: Awaited<ReturnType<typeof createRuntimeEventSink>>
          shouldRunInitialPrompt?: boolean
        }
        | undefined
      let activeRuntimeEventSink: Awaited<ReturnType<typeof createRuntimeEventSink>> | undefined
      let adapterCliPrepareOperationActive = false
      try {
        const description = descriptionArgs.join(' ')
        opts.permissionMode = resolvePermissionModeOption(opts.permissionMode, opts.yolo)
        let lastAssistantText: string | undefined
        let didExitAfterError = false
        let inputClosed = false
        let pendingInteraction: AdapterInteractionRequest | undefined
        const exitController = createSessionExitController()
        const cwd = resolveCliWorkspaceCwd()
        const runtimeSystemPrompt = await readRuntimeSystemPromptFromEnv()
        const adapterSelection = opts.adapter == null
          ? undefined
          : parseCliAdapterOptionValue(opts.adapter)
        if (adapterSelection?.cliVersion != null) {
          applyAdapterCliVersionEnv(process.env, adapterSelection.adapter, adapterSelection.cliVersion)
        }
        const generatedSessionId = opts.sessionId ?? uuid()
        const outputFormatSource = currentCommand.getOptionValueSource('outputFormat')
        const isRuntimeProtocolMode = opts.inputFormat === 'json' && !opts.print ||
          opts.inputFormat === 'stream-json' && !opts.print
        if (isRuntimeProtocolMode) {
          const protocolOutputFormat = outputFormatSource === 'default'
            ? (opts.inputFormat === 'stream-json' ? 'stream-json' : 'json')
            : opts.outputFormat
          if (protocolOutputFormat !== 'json' && protocolOutputFormat !== 'stream-json') {
            throw new Error('Runtime protocol mode requires --output-format json or stream-json.')
          }
          await runRuntimeProtocolStdio({
            cwd,
            env: process.env,
            inputFormat: opts.inputFormat!,
            outputFormat: protocolOutputFormat,
            stdin: process.stdin,
            stdout: process.stdout
          })
          return
        }

        const selectedTargetFlags = [opts.spec, opts.entity, opts.workspace].filter(
          (value): value is string => value != null && value.trim() !== ''
        )
        if (selectedTargetFlags.length > 1) {
          throw new Error('--spec, --entity and --workspace are mutually exclusive.')
        }
        if (opts.inputFormat != null && !opts.print) {
          throw new Error('--input-format is only supported together with --print or runtime protocol mode.')
        }

        const resumeId = opts.resume === true
          ? undefined
          : typeof opts.resume === 'string'
          ? opts.resume
          : undefined
        const forkId = opts.fork === true
          ? undefined
          : typeof opts.fork === 'string'
          ? opts.fork
          : undefined
        const isResume = opts.resume === true || typeof opts.resume === 'string'
        const isFork = opts.fork === true || typeof opts.fork === 'string'
        if (isResume && isFork) {
          throw new Error('--resume and --fork are mutually exclusive.')
        }
        const printSource = currentCommand.getOptionValueSource('print')
        const skills = opts.includeSkill || opts.excludeSkill
          ? {
            include: opts.includeSkill,
            exclude: opts.excludeSkill
          }
          : undefined

        const createCtxId = process.env.__ONEWORKS_PROJECT_CTX_ID__ ?? generatedSessionId

        let runtimeResumeFallbackResult: Awaited<ReturnType<typeof executeRuntimeProtocolCommand>> | undefined
        const initialCachedRecord = isResume || isFork
          ? (() => {
            const disallowedFlags = getDisallowedResumeFlags(opts, currentCommand)
            if (disallowedFlags.length > 0) {
              throw new Error(`${isFork ? 'Fork' : 'Resume'} mode does not accept ${disallowedFlags.join(', ')}.`)
            }
            return resolveCliSession(cwd, isFork ? forkId : resumeId).catch(async (error: unknown) => {
              if (!isResume || resumeId == null) {
                throw error
              }
              const result = await executeRuntimeProtocolCommand({
                commandId: `cli-resume-${uuid()}`,
                type: 'session.resume',
                sessionId: resumeId,
                source: 'cli',
                message: description.trim() === '' ? '继续' : description,
                model: opts.model,
                effort: toRuntimeResumeEffort(opts.effort),
                permissionMode: toRuntimeResumePermissionMode(opts.permissionMode)
              }, {
                cwd,
                env: mergeProcessEnvWithProjectEnv({
                  ONEWORKS_RUNTIME_PROTOCOL_DISABLE_CONSUMER: '1'
                }, { workspaceFolder: cwd })
              })
              if (!result.ok) {
                throw error
              }
              runtimeResumeFallbackResult = result
              return undefined
            })
          })()
          : undefined

        const cachedSession = await initialCachedRecord
        if (isResume && cachedSession == null && runtimeResumeFallbackResult != null) {
          writeRuntimeResumeFallbackResult({
            result: runtimeResumeFallbackResult,
            outputFormat: opts.outputFormat
          })
          return
        }
        if (!isResume && !isFork && adapterSelection?.cliVersion != null) {
          await persistAdapterCliVersionSelection({
            adapter: adapterSelection.adapter,
            cwd,
            version: adapterSelection.cliVersion
          })
        }
        let resolvedTaskCwd = cachedSession?.resume?.taskOptions.cwd ?? cwd
        const cachedAdapter = cachedSession == null
          ? undefined
          : (resolveCliSessionAdapter(cachedSession) || undefined)
        const sessionId = isResume ? (cachedSession?.resume?.sessionId ?? generatedSessionId) : generatedSessionId
        const cachedCtxId = isResume ? cachedSession?.resume?.ctxId : undefined
        const startupProfiler = createStartupProfiler({
          cwd,
          ctxId: cachedCtxId ?? createCtxId ?? sessionId,
          env: process.env,
          sessionId
        })
        const runtimeProtocolConsumerSessionId = process.env.__ONEWORKS_RUNTIME_PROTOCOL_SESSION_ID__?.trim()
        const isRuntimeProtocolConsumer = process.env.__ONEWORKS_RUNTIME_PROTOCOL_CONSUMER__ === '1' &&
          runtimeProtocolConsumerSessionId === sessionId
        if (isRuntimeProtocolConsumer) {
          runtimeConsumerContext = { cwd, sessionId }
          runtimeConsumerContext.sink = await createRuntimeEventSink({ cwd, env: process.env, sessionId })
          const startupRecord = await runtimeConsumerContext.sink.recordStartup(
            await readRuntimeCommands(cwd, sessionId, process.env)
          )
          runtimeConsumerContext.shouldRunInitialPrompt = startupRecord.shouldRunInitialPrompt
        }
        const adapterDescription = runtimeConsumerContext?.shouldRunInitialPrompt === false ? '' : description
        const ctxId = cachedCtxId ?? createCtxId ?? sessionId
        const createHookEnv = (workspaceFolder: string): Record<string, string> => {
          const env = mergeProcessEnvWithProjectEnv({
            ONEWORKS_HOOK_PERSISTENT_WORKER: process.env.ONEWORKS_HOOK_PERSISTENT_WORKER ?? '1',
            __ONEWORKS_PROJECT_CTX_ID__: ctxId,
            __ONEWORKS_PROJECT_LAUNCH_CWD__: workspaceFolder,
            __ONEWORKS_PROJECT_WORKSPACE_FOLDER__: workspaceFolder,
            __ONEWORKS_PROJECT_WORKSPACE_FOLDER_RESOLVE_CWD__: workspaceFolder,
            __ONEWORKS_PROJECT_PRIMARY_WORKSPACE_FOLDER__: resolveRunPrimaryWorkspaceFolder(workspaceFolder, cwd)
          }, { workspaceFolder })
          return Object.fromEntries(
            Object.entries(env).filter((entry): entry is [string, string] => typeof entry[1] === 'string')
          )
        }
        const initialHookWorkerPrewarmStartedAt = startupProfiler.now()
        const initialHookWorkerPrewarm = prewarmPersistentHookWorker(
          createHookEnv(resolvedTaskCwd),
          resolvedTaskCwd,
          { light: true, warmup: true }
        )
        if (initialHookWorkerPrewarm != null) {
          startupProfiler.mark(
            'cli.hookWorker.prewarm.initial',
            initialHookWorkerPrewarmStartedAt,
            { ...initialHookWorkerPrewarm }
          )
        }
        const outputFormat = getOutputFormat(
          opts.outputFormat,
          outputFormatSource,
          cachedSession?.resume?.outputFormat ?? 'text'
        )
        const resumeMode = resolveRunMode(
          opts.print,
          printSource,
          cachedSession?.resume?.adapterOptions.mode ?? 'direct'
        )
        const shouldPrintOutput = resumeMode === 'stream'
        if (opts.printIdleTimeout != null && !shouldPrintOutput) {
          throw new Error('--print-idle-timeout is only supported in print mode.')
        }
        const supportsPrintInteractionInput = supportsRuntimeInteractionResponses(
          opts.inputFormat,
          isRuntimeProtocolConsumer
        )
        const pendingPermissionRecovery = await readCliSessionPermissionRecovery(cwd, ctxId, sessionId)
        const cachedResumePermissionMode = cachedSession?.resume?.adapterOptions.permissionMode
        const resolvedCachedPermissionMode = isResume || isFork
          ? (opts.permissionMode ?? cachedResumePermissionMode)
          : opts.permissionMode
        const permissionRecoveryMode = pendingPermissionRecovery?.permissionMode ?? cachedResumePermissionMode
        const resumePermissionModeChanged = isResume &&
          opts.permissionMode != null &&
          opts.permissionMode !== permissionRecoveryMode
        const activePermissionRecovery = resumePermissionModeChanged ? undefined : pendingPermissionRecovery

        if (resumePermissionModeChanged && pendingPermissionRecovery != null) {
          await clearCliSessionPermissionRecovery(cwd, ctxId, sessionId)
        } else if (isResume && activePermissionRecovery != null) {
          if (shouldPrintOutput) {
            handlePrintEvent({
              event: {
                type: 'interaction_request',
                data: {
                  id: `cli-recovery:${sessionId}`,
                  payload: activePermissionRecovery.payload
                }
              },
              outputFormat,
              lastAssistantText,
              didExitAfterError,
              exitOnInteractionRequest: false,
              log: (message) => console.log(message),
              errorLog: (message) => console.error(message),
              requestExit: () => {}
            })
          } else {
            console.error(getAdapterInteractionMessage(activePermissionRecovery.payload))
          }

          if (opts.inputFormat == null) {
            console.error(
              `Resume with --print --input-format to answer this permission request for session ${sessionId}.`
            )
            process.exit(1)
          }

          const answer = await readCliPermissionDecision({
            format: opts.inputFormat,
            stdin: process.stdin
          })
          const decision = resolvePermissionInteractionDecision(answer)
          if (decision == null) {
            throw new TypeError('Permission recovery requires a decision like allow_once or deny_project.')
          }

          if (decision === PERMISSION_DECISION_CANCEL) {
            console.error('Permission recovery cancelled. Session was not resumed.')
            process.exit(1)
          }
          if (shouldApplyPermissionDecision(decision)) {
            await applyCliPermissionDecision({
              cwd: resolvedTaskCwd,
              sessionId,
              adapter: activePermissionRecovery.adapter,
              subjectKeys: activePermissionRecovery.subjectKeys,
              action: decision
            })
          }
          if (shouldClearPermissionRecoveryCache(decision)) {
            await clearCliSessionPermissionRecovery(cwd, ctxId, sessionId)
          }
          if (isTerminalPermissionDecision(decision)) {
            console.error(`Permission decision applied: ${decision}. Session was not resumed.`)
            process.exit(1)
          }
        }

        const adapterOptions = cachedSession?.resume != null
          ? {
            ...resolveResumeAdapterOptions(cachedSession.resume.adapterOptions, opts),
            type: isResume ? 'resume' as const : 'create' as const,
            description: activePermissionRecovery == null
              ? adapterDescription
              : (adapterDescription.trim() === ''
                ? PERMISSION_RECOVERY_CONTINUE_PROMPT
                : `${PERMISSION_RECOVERY_CONTINUE_PROMPT}\n\n${adapterDescription}`),
            permissionMode: resolvedCachedPermissionMode,
            mode: resumeMode,
            sessionId,
            extraOptions
          }
          : await (async () => {
            const promptType = opts.workspace
              ? 'workspace'
              : (opts.spec ? 'spec' : (opts.entity ? 'entity' : undefined))
            const promptName = opts.workspace || opts.spec || opts.entity
            const adapterQueryOptionsStartedAt = nowStartupMs()
            const [data, resolvedConfig] = await generateAdapterQueryOptions(
              promptType,
              promptName,
              cwd,
              {
                skills,
                adapter: cachedAdapter ?? adapterSelection?.adapter,
                model: opts.model,
                plugins: getCliDefaultSkillPluginConfig(),
                updateConfiguredSkills: opts.updateSkills === true
              }
            )
            startupProfiler.mark('cli.generateAdapterQueryOptions', adapterQueryOptionsStartedAt)
            resolvedTaskCwd = resolvedConfig.workspace?.cwd ?? cwd
            const env = createHookEnv(resolvedTaskCwd)
            const resolvedHookWorkerPrewarmStartedAt = startupProfiler.now()
            const resolvedHookWorkerPrewarm = prewarmPersistentHookWorker(env, resolvedTaskCwd, {
              pluginConfig: resolvedConfig.assetBundle?.pluginConfigs,
              pluginInstances: resolvedConfig.assetBundle?.pluginInstances
            })
            if (resolvedHookWorkerPrewarm != null) {
              startupProfiler.mark(
                'cli.hookWorker.prewarm.resolved',
                resolvedHookWorkerPrewarmStartedAt,
                { ...resolvedHookWorkerPrewarm }
              )
            }
            const generateSystemPromptHookStartedAt = startupProfiler.now()
            await callHook('GenerateSystemPrompt', {
              cwd: resolvedTaskCwd,
              sessionId,
              type: promptType,
              name: promptName,
              data
            }, env)
            startupProfiler.mark('cli.hook.GenerateSystemPrompt', generateSystemPromptHookStartedAt)

            const injectSystemPromptStartedAt = startupProfiler.now()
            const injectDefaultSystemPrompt = await loadInjectDefaultSystemPromptValue(
              resolvedTaskCwd,
              resolveInjectDefaultSystemPromptOption(
                opts.injectDefaultSystemPrompt,
                currentCommand.getOptionValueSource('injectDefaultSystemPrompt')
              ),
              env
            )
            startupProfiler.mark('cli.loadInjectDefaultSystemPrompt', injectSystemPromptStartedAt)

            return {
              type: 'create' as const,
              description: adapterDescription,
              runtime: 'cli' as const,
              sessionId,
              model: opts.model,
              account: opts.account,
              effort: opts.effort,
              systemPrompt: mergeSystemPrompts({
                generatedSystemPrompt: resolvedConfig.systemPrompt,
                userSystemPrompt: opts.systemPrompt ?? runtimeSystemPrompt,
                injectDefaultSystemPrompt
              }),
              permissionMode: opts.permissionMode,
              mode: resolveRunMode(
                opts.print,
                printSource,
                'direct'
              ),
              tools: mergeListConfig(
                resolvedConfig.tools,
                opts.includeTool,
                opts.excludeTool
              ),
              mcpServers: mergeListConfig(
                resolvedConfig.mcpServers,
                opts.includeMcpServer,
                opts.excludeMcpServer
              ),
              useDefaultOneworksMcpServer: resolveDefaultOneworksMcpServerOption(
                opts.defaultOneworksMcpServer,
                currentCommand.getOptionValueSource('defaultOneworksMcpServer')
              ),
              promptAssetIds: resolvedConfig.promptAssetIds,
              skills,
              extraOptions,
              assetBundle: resolvedConfig.assetBundle
            }
          })()
        const {
          type: _adapterType,
          description: _adapterDescription,
          ...cachedAdapterOptions
        } = adapterOptions
        const runTaskOptions = isResume || isFork
          ? undefined
          : {
            adapter: adapterSelection?.adapter,
            cwd: resolvedTaskCwd,
            ctxId
          }

        const record: ActiveCliSessionRecord = {
          resume: {
            version: 1 as const,
            ctxId,
            sessionId,
            cwd: cachedSession?.resume?.cwd ?? resolvedTaskCwd,
            description: description || cachedSession?.resume?.description,
            createdAt: isResume ? (cachedSession?.resume?.createdAt ?? Date.now()) : Date.now(),
            updatedAt: Date.now(),
            resolvedAdapter: cachedSession?.resume?.resolvedAdapter ?? cachedAdapter,
            taskOptions: {
              ...(cachedSession?.resume?.taskOptions ?? {
                cwd: resolvedTaskCwd,
                ctxId
              }),
              ctxId,
              adapter: cachedAdapter ?? runTaskOptions?.adapter
            },
            adapterOptions: cachedAdapterOptions,
            outputFormat
          },
          detail: {
            ctxId,
            sessionId,
            status: 'pending',
            startTime: isResume ? (cachedSession?.detail?.startTime ?? Date.now()) : Date.now(),
            description: description || cachedSession?.detail?.description || cachedSession?.resume?.description,
            adapter: cachedSession?.detail?.adapter ?? cachedAdapter,
            model: adapterOptions.model ?? cachedSession?.detail?.model ?? cachedSession?.resume?.adapterOptions.model
          }
        }

        let persistQueue = Promise.resolve()
        const persistRecord = () => {
          persistQueue = persistQueue
            .catch(() => {})
            .then(() => writeCliSessionRecord(cwd, ctxId, sessionId, record))
            .catch((error) => {
              const message = error instanceof Error ? error.message : String(error)
              console.error(`[oneworks] Failed to update session cache: ${message}`)
            })
          return persistQueue
        }
        const updateInitRecord = (info: SessionInitInfo, pid: number | undefined) => {
          const resolvedAdapter = info.adapter ?? record.resume.resolvedAdapter ?? record.resume.taskOptions.adapter
          record.resume = {
            ...record.resume,
            updatedAt: Date.now(),
            resolvedAdapter,
            taskOptions: {
              ...record.resume.taskOptions,
              adapter: resolvedAdapter
            },
            adapterOptions: {
              ...record.resume.adapterOptions,
              model: info.model,
              effort: info.effort ?? record.resume.adapterOptions.effort
            }
          }
          record.detail = {
            ...record.detail,
            status: 'running',
            pid: pid ?? record.detail.pid,
            adapter: resolvedAdapter ?? record.detail.adapter,
            model: info.model ?? record.detail.model
          }
          void persistRecord()
        }

        await persistRecord()

        let runtimeEventSink = runtimeConsumerContext?.sink
        if (runtimeEventSink == null && !isResume) {
          runtimeEventSink = await createCliRuntimeEventSink({
            adapter: record.resume.resolvedAdapter ?? record.resume.taskOptions.adapter,
            cwd: record.resume.taskOptions.cwd ?? record.resume.cwd,
            effort: toRuntimeResumeEffort(record.resume.adapterOptions.effort),
            env: process.env,
            message: record.resume.description,
            model: record.resume.adapterOptions.model,
            permissionMode: toRuntimeResumePermissionMode(record.resume.adapterOptions.permissionMode),
            sessionId,
            title: record.detail.description ?? record.resume.description ?? sessionId
          })
        }
        activeRuntimeEventSink = runtimeEventSink

        let boundSession: PrintInputCapableSession | undefined
        let stopInputBridge: (() => void) | undefined
        let stopRuntimeCommandBridge: (() => Promise<void>) | undefined
        const permissionToolUseCache = new Map<string, string>()
        let permissionRecoveryQueue: Promise<void> = Promise.resolve()
        let didHandleExit = false
        let printIdleTimeoutController: ReturnType<typeof createPrintIdleTimeoutController> | undefined
        let unhandledRejectionHandler: ((reason: unknown) => void) | undefined
        let uncaughtExceptionHandler: ((error: Error) => void) | undefined
        const cleanupRuntimeConsumerFailureHandlers = () => {
          if (unhandledRejectionHandler != null) {
            process.off('unhandledRejection', unhandledRejectionHandler)
          }
          if (uncaughtExceptionHandler != null) {
            process.off('uncaughtException', uncaughtExceptionHandler)
          }
        }
        const submitPrintInput = async (params: { interactionId?: string; data: string | string[] }) => {
          const interactionId = params.interactionId ?? pendingInteraction?.id
          if (interactionId == null || interactionId.trim() === '') {
            throw new TypeError('No pending interaction is available. Wait for an interaction_request event first.')
          }
          const respondInteraction = boundSession?.respondInteraction
          if (typeof respondInteraction !== 'function') {
            throw new TypeError('The current session does not support submit_input events.')
          }

          await respondInteraction(interactionId, params.data)

          if (pendingInteraction?.id === interactionId) {
            pendingInteraction = undefined
          }
        }
        const handleExit = (exitCode: number) => {
          if (didHandleExit) {
            return
          }
          didHandleExit = true
          printIdleTimeoutController?.stop()
          void (async () => {
            const endedAt = Date.now()
            const [persistedDetail, control] = await Promise.all([
              getCache(record.resume.taskOptions.cwd ?? record.resume.cwd, ctxId, sessionId, 'detail'),
              readCliSessionControl(cwd, ctxId, sessionId)
            ])
            record.resume = {
              ...record.resume,
              updatedAt: endedAt
            }
            const status = persistedDetail?.status === 'stopped' || isCliSessionStopActive(control, endedAt)
              ? 'stopped'
              : exitCode === 0
              ? 'completed'
              : 'failed'
            record.detail = {
              ...record.detail,
              endTime: endedAt,
              exitCode,
              status
            }
            await persistRecord()
            await persistQueue
            await permissionRecoveryQueue
            await stopRuntimeCommandBridge?.()
            await runtimeEventSink?.flush()
            cleanupRuntimeConsumerFailureHandlers()
            await clearCliSessionControl(cwd, ctxId, sessionId)
            stopInputBridge?.()
            await boundSession?.flushHooks?.()
            if (shouldPrintResumeHint({ shouldPrintOutput, status })) {
              console.error(formatResumeCommand(sessionId))
            }
            exitController.handleSessionExit(exitCode)
          })()
        }
        const runtimeConsumerFailureHandler = runtimeEventSink == null
          ? undefined
          : (error: unknown) => {
            const message = error instanceof Error ? error.message : String(error)
            console.error(message)
            void runtimeEventSink.recordFailure(error)
              .catch(() => {})
              .then(() => handleExit(1))
          }
        unhandledRejectionHandler = runtimeConsumerFailureHandler == null
          ? undefined
          : (reason: unknown) => runtimeConsumerFailureHandler(reason)
        uncaughtExceptionHandler = runtimeConsumerFailureHandler == null
          ? undefined
          : (error: Error) => runtimeConsumerFailureHandler(error)
        if (unhandledRejectionHandler != null) {
          process.once('unhandledRejection', unhandledRejectionHandler)
        }
        if (uncaughtExceptionHandler != null) {
          process.once('uncaughtException', uncaughtExceptionHandler)
        }
        if (shouldPrintOutput && opts.printIdleTimeout != null) {
          printIdleTimeoutController = createPrintIdleTimeoutController({
            timeoutSeconds: opts.printIdleTimeout,
            onTimeout: () => {
              const exitCode = exitController.getPendingExitCode() ?? 1
              console.error(
                `[oneworks] Print mode idle timeout: no adapter events received for ${opts.printIdleTimeout} seconds.`
              )
              exitController.requestExit(exitCode)
              handleExit(exitCode)
            }
          })
          printIdleTimeoutController.start()
        }

        const recordAdapterCliPrepareOperation = (
          type: 'operation_started' | 'operation_completed' | 'operation_failed',
          message: string,
          error?: string
        ) => {
          adapterCliPrepareOperationActive = type === 'operation_started'
          return runtimeEventSink?.recordOperation({
            type,
            operationId: ADAPTER_CLI_PREPARE_OPERATION_ID,
            title: ADAPTER_CLI_PREPARE_OPERATION_TITLE,
            message,
            ...(error != null ? { error } : {})
          }) ?? Promise.resolve()
        }

        const runStartedAt = startupProfiler.now()
        await recordAdapterCliPrepareOperation('operation_started', ADAPTER_CLI_PREPARE_STARTED_MESSAGE)
        const { session, resolvedAdapter } = await run({
          adapter: record.resume.resolvedAdapter ?? record.resume.taskOptions.adapter,
          cwd: record.resume.taskOptions.cwd ?? record.resume.cwd,
          ctxId,
          updateConfiguredSkills: opts.updateSkills === true,
          env: createHookEnv(record.resume.taskOptions.cwd ?? record.resume.cwd),
          plugins: getCliDefaultSkillPluginConfig()
        }, {
          ...adapterOptions,
          onEvent: (event: AdapterOutputEvent) => {
            printIdleTimeoutController?.recordEvent()
            void runtimeEventSink?.handleAdapterEvent(event)
            if (event.type === 'init') {
              if (adapterCliPrepareOperationActive) {
                adapterCliPrepareOperationActive = false
                void runtimeEventSink?.recordOperation({
                  type: 'operation_completed',
                  operationId: ADAPTER_CLI_PREPARE_OPERATION_ID,
                  title: ADAPTER_CLI_PREPARE_OPERATION_TITLE,
                  message: ADAPTER_CLI_PREPARE_COMPLETED_MESSAGE
                })
              }
              updateInitRecord(event.data, boundSession?.pid)
            }
            if (event.type === 'message') {
              rememberPermissionToolUses(permissionToolUseCache, event.data)
            }
            if (event.type === 'error' && event.data.code === 'permission_required') {
              const permissionRecovery = buildPermissionRecoveryRecord({
                sessionId,
                adapter: resolvedAdapter ?? record.resume.resolvedAdapter ?? record.resume.taskOptions.adapter,
                currentMode: record.resume.adapterOptions.permissionMode,
                context: extractPermissionErrorContext(event.data, {
                  toolUseSubjects: permissionToolUseCache
                })
              })
              if (permissionRecovery != null) {
                permissionRecoveryQueue = permissionRecoveryQueue
                  .catch(() => {})
                  .then(async () => {
                    await writeCliSessionPermissionRecovery(cwd, ctxId, sessionId, permissionRecovery)
                  })
                if (shouldPrintOutput) {
                  const nextState = handlePrintEvent({
                    event: {
                      type: 'interaction_request',
                      data: {
                        id: `cli-recovery:${sessionId}`,
                        payload: permissionRecovery.payload
                      }
                    },
                    outputFormat,
                    lastAssistantText,
                    didExitAfterError,
                    exitOnInteractionRequest: true,
                    log: (message) => console.log(message),
                    errorLog: (message) => console.error(message),
                    requestExit: (code) => exitController.requestExit(code)
                  })
                  lastAssistantText = nextState.lastAssistantText
                  didExitAfterError = nextState.didExitAfterError
                }
                return
              }
            }
            if (event.type === 'interaction_request') {
              pendingInteraction = event.data
              if (shouldPrintOutput && opts.inputFormat != null && !supportsPrintInteractionInput) {
                console.error(
                  'Print-mode interaction responses require --input-format stream-json. Exiting after printing the request.'
                )
              }
            }
            if (
              event.type === 'stop' ||
              event.type === 'exit' ||
              (event.type === 'error' && event.data.fatal !== false)
            ) {
              pendingInteraction = undefined
            }
            if (shouldPrintOutput) {
              const nextState = handlePrintEvent({
                event,
                outputFormat,
                lastAssistantText,
                didExitAfterError,
                exitOnInteractionRequest: event.type === 'interaction_request' &&
                  !isRuntimeProtocolConsumer &&
                  (!supportsPrintInteractionInput || inputClosed),
                stopExitsStreamJson: outputFormat === 'stream-json' &&
                  !isRuntimeProtocolConsumer &&
                  (opts.inputFormat == null || inputClosed),
                log: (message) => console.log(message),
                errorLog: (message) => console.error(message),
                requestExit: (code) => exitController.requestExit(code)
              })
              lastAssistantText = nextState.lastAssistantText
              didExitAfterError = nextState.didExitAfterError
            }
            if (event.type === 'exit') {
              handleExit(exitController.getPendingExitCode() ?? event.data.exitCode ?? 0)
            }
            if (isRuntimeProtocolConsumer && event.type === 'stop') {
              handleExit(exitController.getPendingExitCode() ?? 0)
            }
            if (isRuntimeProtocolConsumer && event.type === 'error' && event.data.fatal !== false) {
              handleExit(1)
            }
          }
        })
        startupProfiler.mark('cli.task.run', runStartedAt)
        boundSession = session
        record.resume = {
          ...record.resume,
          resolvedAdapter: resolvedAdapter ?? record.resume.resolvedAdapter,
          taskOptions: {
            ...record.resume.taskOptions,
            adapter: resolvedAdapter ?? record.resume.taskOptions.adapter
          }
        }
        record.detail = {
          ...record.detail,
          pid: session.pid ?? record.detail.pid,
          status: record.detail.status === 'pending' ? 'running' : record.detail.status,
          adapter: resolvedAdapter ?? record.detail.adapter
        }
        void persistRecord()
        exitController.bindSession(session)
        if (runtimeEventSink != null) {
          stopRuntimeCommandBridge = await attachRuntimeCommandBridge({
            cwd,
            env: process.env,
            session,
            sessionId,
            sink: runtimeEventSink,
            submitInput: submitPrintInput
          })
        }
        if (shouldPrintOutput && opts.inputFormat != null) {
          stopInputBridge = attachInputBridge({
            format: opts.inputFormat,
            session,
            stdin: process.stdin,
            onError: (message) => {
              console.error(message)
              exitController.requestExit(1)
            },
            onInputClosed: () => {
              inputClosed = true
              if (pendingInteraction != null) {
                exitController.requestExit(1)
              }
            },
            submitInput: submitPrintInput
          })
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        const failureSink = activeRuntimeEventSink ??
          (runtimeConsumerContext == null
            ? undefined
            : runtimeConsumerContext.sink ??
              await createRuntimeEventSink({
                cwd: runtimeConsumerContext.cwd,
                env: process.env,
                sessionId: runtimeConsumerContext.sessionId
              }))
        if (failureSink != null) {
          try {
            if (adapterCliPrepareOperationActive) {
              adapterCliPrepareOperationActive = false
              await failureSink.recordOperation({
                type: 'operation_failed',
                operationId: ADAPTER_CLI_PREPARE_OPERATION_ID,
                title: ADAPTER_CLI_PREPARE_OPERATION_TITLE,
                message: ADAPTER_CLI_PREPARE_FAILED_MESSAGE,
                error: message
              })
            }
            await failureSink.recordFailure(error)
            await failureSink.flush()
          } catch (sinkError) {
            const message = sinkError instanceof Error ? sinkError.message : String(sinkError)
            console.error(`[runtime-protocol] Failed to record runtime failure: ${message}`)
          }
        }
        console.error(message)
        process.exit(1)
      }
    })
}

export function registerRunCommand(program: Command) {
  configureRunCommand(
    program
      .command('__run', { hidden: true })
      .description('Run or resume a session')
  )
}

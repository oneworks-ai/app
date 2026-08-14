/* eslint-disable max-lines -- adapter asset diagnostics stay centralized in one planner. */
import { dirname } from 'node:path'

import type {
  AdapterAssetPlan,
  AdapterOverlayEntry,
  AssetDiagnostic,
  WorkspaceAssetAdapter,
  WorkspaceAssetBundle,
  WorkspaceMcpSelection,
  WorkspaceSkillSelection
} from '@oneworks/types'

import { resolveNativeSkillDiagnosticReason, supportsNativeProjectSkills } from './adapter-capabilities'
import { resolveWorkspaceAssetSource } from './asset-source'
import { pushJunieOverlayDiagnostics, resolveJunieAgentOverlays } from './junie-asset-plan'
import { resolveSelectedMcpNames, resolveSelectedSkillAssetsWithDependencies } from './selection-internal'
export async function buildAdapterAssetPlan(params: {
  adapter: WorkspaceAssetAdapter
  bundle: WorkspaceAssetBundle
  options: {
    mcpServers?: WorkspaceMcpSelection
    skills?: WorkspaceSkillSelection
    promptAssetIds?: string[]
  }
}): Promise<AdapterAssetPlan> {
  const diagnostics: AssetDiagnostic[] = []
  const pushDiagnostic = (
    asset: Parameters<typeof resolveWorkspaceAssetSource>[0] & {
      id: string
      packageId?: string
      scope?: string
      instancePath?: string
      taskOverlaySource?: string
    },
    diagnostic: Pick<AssetDiagnostic, 'adapter' | 'status' | 'reason'>
  ) => {
    diagnostics.push({
      assetId: asset.id,
      adapter: diagnostic.adapter,
      status: diagnostic.status,
      reason: diagnostic.reason,
      source: resolveWorkspaceAssetSource(asset),
      packageId: asset.packageId,
      scope: asset.scope,
      instancePath: asset.instancePath,
      origin: asset.origin,
      resolvedBy: asset.resolvedBy,
      taskOverlaySource: asset.taskOverlaySource
    })
  }
  for (const assetId of params.options.promptAssetIds ?? []) {
    const asset = params.bundle.assets.find(item => item.id === assetId)
    if (asset == null || asset.kind === 'mcpServer') continue
    pushDiagnostic(asset, {
      adapter: params.adapter,
      status: 'prompt',
      reason: 'Mapped into the generated system prompt.'
    })
  }
  const selectedMcpNames = resolveSelectedMcpNames(params.bundle, params.options.mcpServers)
  const unsupportedGooseMcpNames = new Set(
    params.adapter === 'goose'
      ? selectedMcpNames.filter(name => params.bundle.mcpServers[name].payload.config.type === 'sse')
      : []
  )
  const isSupportedMcpServer = (name: string) => (
    params.adapter !== 'pi' &&
    params.adapter !== 'dsh' &&
    params.adapter !== 'cline' &&
    !unsupportedGooseMcpNames.has(name) &&
    (params.adapter !== 'kiro' || 'command' in params.bundle.mcpServers[name].payload.config)
  )
  const mcpServers = Object.fromEntries(
    selectedMcpNames
      .filter(isSupportedMcpServer)
      .map(name => [name, params.bundle.mcpServers[name].payload.config])
  )
  selectedMcpNames.forEach((name) => {
    const asset = params.bundle.mcpServers[name]
    const config = asset.payload.config
    const kiroRemoteTransport = params.adapter === 'kiro' && !('command' in config) ? config.type : undefined
    pushDiagnostic(asset, {
      adapter: params.adapter,
      status: params.adapter === 'claude-code'
        ? 'native'
        : !isSupportedMcpServer(name)
        ? 'skipped'
        : 'translated',
      reason: params.adapter === 'claude-code'
        ? 'Mapped into adapter MCP settings.'
        : params.adapter === 'cline'
        ? 'Cline 3.0.54 ACP accepts MCP descriptors but did not demonstrate an observable connection; skipped.'
        : params.adapter === 'pi'
        ? 'Pi has no stable built-in MCP mapping; no third-party extension is loaded implicitly.'
        : params.adapter === 'dsh'
        ? 'The verified DSH ACP contract does not accept MCP servers; this selection was skipped.'
        : params.adapter === 'goose'
        ? unsupportedGooseMcpNames.has(name)
          ? 'Skipped because Goose ACP does not support SSE MCP servers; stdio and HTTP transports remain available.'
          : 'Passed through Goose ACP session/new or session/load as MCP configuration.'
        : kiroRemoteTransport != null
        ? `Kiro ACP supports only stdio MCP servers in the verified CLI contract; ${kiroRemoteTransport.toUpperCase()} transport was skipped.`
        : params.adapter === 'kiro'
        ? 'Mapped into the Kiro ACP session as a stdio MCP server.'
        : 'Translated into adapter-specific MCP configuration.'
    })
  })
  params.bundle.hookPlugins.forEach((asset) => {
    pushDiagnostic(asset, {
      adapter: params.adapter,
      status: params.adapter === 'pi' || params.adapter === 'cline' || params.adapter === 'dsh' ||
          params.adapter === 'goose'
        ? 'translated'
        : 'native',
      reason: params.adapter === 'claude-code'
        ? 'Mapped into the Claude Code native hooks bridge.'
        : params.adapter === 'cline'
        ? 'Cline 3.0.54 native --hooks-dir execution is unverified; mapped through the One Works event hook bridge.'
        : params.adapter === 'codex'
        ? 'Mapped into the Codex native hooks bridge.'
        : params.adapter === 'gemini'
        ? 'Mapped into the Gemini native hooks bridge.'
        : params.adapter === 'copilot'
        ? 'Mapped into the Copilot CLI native hooks bridge.'
        : params.adapter === 'cursor'
        ? 'Mapped into the Cursor native hooks bridge.'
        : params.adapter === 'dsh'
        ? 'Mapped through the normalized One Works adapter event hook bridge.'
        : params.adapter === 'droid'
        ? 'Mapped into the Factory Droid native hooks bridge.'
        : params.adapter === 'grok'
        ? 'Mapped into the Grok native hooks bridge.'
        : params.adapter === 'goose'
        ? 'Mapped through the normalized One Works adapter event hook bridge; Goose ACP hooks are not injected.'
        : params.adapter === 'kiro'
        ? 'Mapped into the Kiro native hooks bridge.'
        : params.adapter === 'junie'
        ? 'Mapped into the Junie headless native hooks bridge.'
        : params.adapter === 'qwen-code'
        ? 'Mapped into the Qwen Code native hooks bridge.'
        : params.adapter === 'kimi'
        ? 'Mapped into the Kimi native hooks bridge.'
        : params.adapter === 'pi'
        ? 'Mapped through the normalized One Works adapter event hook bridge.'
        : 'Mapped into the OpenCode native hooks bridge.'
    })
  })

  const selectedSkillAssets = await resolveSelectedSkillAssetsWithDependencies(params.bundle, params.options.skills)
  if (supportsNativeProjectSkills(params.adapter)) {
    selectedSkillAssets.forEach((asset) => {
      pushDiagnostic(asset, {
        adapter: params.adapter,
        status: 'native',
        reason: resolveNativeSkillDiagnosticReason(params.adapter)
      })
    })
  }
  if (params.adapter === 'opencode') {
    params.bundle.opencodeOverlayAssets.forEach((asset) => {
      pushDiagnostic(asset, {
        adapter: params.adapter,
        status: 'native',
        reason: 'Mirrored into OPENCODE_CONFIG_DIR as a native OpenCode asset.'
      })
    })
  } else if (params.adapter === 'junie') {
    pushJunieOverlayDiagnostics(params.bundle.opencodeOverlayAssets, pushDiagnostic)
  } else if (
    params.adapter === 'codex' ||
    params.adapter === 'cline' ||
    params.adapter === 'copilot' ||
    params.adapter === 'cursor' ||
    params.adapter === 'dsh' ||
    params.adapter === 'goose' ||
    params.adapter === 'droid' ||
    params.adapter === 'grok' ||
    params.adapter === 'kiro' ||
    params.adapter === 'kimi' ||
    params.adapter === 'pi' ||
    params.adapter === 'qwen-code'
  ) {
    params.bundle.opencodeOverlayAssets.forEach((asset) => {
      pushDiagnostic(asset, {
        adapter: params.adapter,
        status: 'skipped',
        reason: params.adapter === 'codex'
          ? 'No stable native Codex mapping exists for this asset kind in V1.'
          : params.adapter === 'cline'
          ? 'No stable native Cline mapping exists for this OpenCode asset kind in V1.'
          : params.adapter === 'copilot'
          ? 'No stable native Copilot mapping exists for this asset kind in V1.'
          : params.adapter === 'cursor'
          ? 'No stable native Cursor mapping exists for this asset kind in V1.'
          : params.adapter === 'dsh'
          ? 'No stable native DSH mapping exists for this OpenCode asset kind.'
          : params.adapter === 'droid'
          ? 'Factory plugins and OpenCode assets are skipped because stream-jsonrpc has no session-scoped plugin injection contract.'
          : params.adapter === 'grok'
          ? 'No stable native Grok mapping exists for this asset kind in V1.'
          : params.adapter === 'goose'
          ? 'Goose recipes and extensions are not loaded implicitly; One Works remains the asset orchestrator.'
          : params.adapter === 'kiro'
          ? 'No stable native Kiro mapping exists for this OpenCode asset kind in V1.'
          : params.adapter === 'pi'
          ? 'No stable native Pi mapping exists for this OpenCode asset kind in V1.'
          : params.adapter === 'qwen-code'
          ? 'No stable native Qwen Code mapping exists for this OpenCode asset kind in V1.'
          : 'No stable native Kimi mapping exists for this asset kind in V1.'
      })
    })
  } else if (params.adapter === 'gemini') {
    params.bundle.opencodeOverlayAssets.forEach((asset) => {
      pushDiagnostic(asset, {
        adapter: params.adapter,
        status: 'skipped',
        reason: 'No stable native Gemini mapping exists for this asset kind in V1.'
      })
    })
  }

  const selectedSkillOverlays = selectedSkillAssets.map((asset): AdapterOverlayEntry => ({
    assetId: asset.id,
    kind: 'skill',
    sourcePath: dirname(asset.sourcePath),
    targetPath: `skills/${asset.displayName.replaceAll('/', '__')}`
  }))
  const overlays: AdapterOverlayEntry[] = params.adapter === 'opencode'
    ? [
      ...selectedSkillOverlays,
      ...params.bundle.opencodeOverlayAssets.map((asset): AdapterOverlayEntry => ({
        assetId: asset.id,
        kind: asset.kind,
        sourcePath: asset.sourcePath,
        targetPath: asset.payload.targetSubpath
      }))
    ]
    : params.adapter === 'junie'
    ? [...selectedSkillOverlays, ...resolveJunieAgentOverlays(params.bundle.opencodeOverlayAssets)]
    : params.adapter === 'codex' ||
        params.adapter === 'cline' ||
        params.adapter === 'copilot' ||
        params.adapter === 'cursor' ||
        params.adapter === 'goose' ||
        params.adapter === 'droid' ||
        params.adapter === 'grok' ||
        params.adapter === 'kiro' ||
        params.adapter === 'pi' ||
        params.adapter === 'qwen-code'
    ? selectedSkillOverlays
    : params.adapter === 'kimi'
    ? selectedSkillAssets.map((asset): AdapterOverlayEntry => ({
      assetId: asset.id,
      kind: 'skill',
      sourcePath: dirname(asset.sourcePath),
      targetPath: asset.displayName.replaceAll('/', '__')
    }))
    : []

  return { adapter: params.adapter, diagnostics, mcpServers, overlays }
}

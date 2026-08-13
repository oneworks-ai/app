import { basename } from 'node:path'

import type { AdapterOverlayEntry, AssetDiagnostic, WorkspaceAssetBundle } from '@oneworks/types'

type OverlayAsset = WorkspaceAssetBundle['opencodeOverlayAssets'][number]
type PushDiagnostic = (
  asset: OverlayAsset,
  diagnostic: Pick<AssetDiagnostic, 'adapter' | 'reason' | 'status'>
) => void

export const pushJunieOverlayDiagnostics = (
  assets: OverlayAsset[],
  pushDiagnostic: PushDiagnostic
) => {
  assets.forEach((asset) => {
    pushDiagnostic(asset, {
      adapter: 'junie',
      status: asset.kind === 'agent' ? 'native' : 'skipped',
      reason: asset.kind === 'agent'
        ? 'Passed to Junie through an explicit isolated --agent-location.'
        : 'Junie has no verified native mapping for this OpenCode asset kind.'
    })
  })
}

export const resolveJunieAgentOverlays = (assets: OverlayAsset[]): AdapterOverlayEntry[] => (
  assets
    .filter(asset => asset.kind === 'agent')
    .map(asset => ({
      assetId: asset.id,
      kind: 'agent',
      sourcePath: asset.sourcePath,
      targetPath: `agents/${basename(asset.sourcePath)}`
    }))
)

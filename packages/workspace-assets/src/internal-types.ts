import type { WorkspaceAsset } from '@oneworks/types'

export const isOpenCodeOverlayAsset = (
  asset: WorkspaceAsset
): asset is Extract<WorkspaceAsset, { kind: 'nativePlugin' }> => asset.kind === 'nativePlugin'

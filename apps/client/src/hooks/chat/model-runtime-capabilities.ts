import type { AdapterBuiltinModel, EffortLevel } from '@oneworks/types'

export const DEFAULT_CHAT_EFFORTS: EffortLevel[] = ['low', 'medium', 'high', 'max']

const normalizeModelId = (model: string | undefined) => {
  const normalized = model?.trim()
  if (normalized == null || normalized === '') return 'default'
  if (!normalized.includes(',')) return normalized
  return undefined
}

export const resolveAdapterModelRuntimeCapabilities = ({
  adapter,
  adapterBuiltinModels,
  model
}: {
  adapter?: string
  adapterBuiltinModels?: Record<string, AdapterBuiltinModel[]>
  model?: string
}) => {
  const modelId = normalizeModelId(model)
  const models = adapter == null ? undefined : adapterBuiltinModels?.[adapter]
  const metadata = modelId == null ? undefined : models?.find(item => item.value === modelId)
  const supportedEfforts = metadata?.supportedEfforts ?? DEFAULT_CHAT_EFFORTS
  const supportsFastMode = adapter === 'codex' && metadata?.serviceTiers?.some(tier => {
        const id = tier.id.toLowerCase()
        const name = tier.name.toLowerCase()
        return id === 'priority' || id === 'fast' || name === 'fast'
      }) === true

  return {
    defaultEffort: metadata?.defaultEffort,
    supportedEfforts,
    supportsFastMode
  }
}

import useSWR from 'swr'

import type { ConfigResponse, ExperimentsConfig } from '@oneworks/types'

import { getConfig } from '#~/api'

const emptyExperiments: ExperimentsConfig = {}

export function resolveExperiments(configRes?: ConfigResponse): ExperimentsConfig {
  return configRes?.sources?.merged?.experiments ?? emptyExperiments
}

export function useExperiments() {
  const { data: configRes } = useSWR<ConfigResponse>('/api/config', getConfig)

  return resolveExperiments(configRes)
}

export function useExperimentsState() {
  const { data: configRes, isLoading } = useSWR<ConfigResponse>('/api/config', getConfig)

  return {
    experiments: resolveExperiments(configRes),
    isLoading
  }
}

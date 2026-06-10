import useSWR from 'swr'

import type { ConfigResponse } from '@oneworks/types'

import { getConfig } from '#~/api'

const resolveSessionTimelineExperiment = (configRes?: ConfigResponse) => {
  if (configRes == null) {
    return undefined
  }

  return configRes.sources?.merged?.experiments?.sessionTimeline === true
}

export function useSessionTimelineExperiment(override?: boolean) {
  const { data: configRes } = useSWR<ConfigResponse>(
    override == null ? '/api/config' : null,
    getConfig
  )

  return override ?? resolveSessionTimelineExperiment(configRes)
}

import type { AppearanceHistoryTimelineMode } from '@oneworks/types'

import { ConfigIconRadioGroup } from './ConfigIconRadioGroup'
import type { TranslationFn } from './configUtils'

export function HistoryTimelineModeRadioGroup({
  value,
  t,
  onChange
}: {
  value: AppearanceHistoryTimelineMode
  t: TranslationFn
  onChange: (value: AppearanceHistoryTimelineMode) => void
}) {
  return (
    <ConfigIconRadioGroup
      ariaLabel={t('config.appSettings.historyTimelineMode.label')}
      value={value}
      onChange={onChange}
      options={[
        {
          icon: 'density_small',
          label: t('config.appSettings.historyTimelineMode.eventLine'),
          value: 'event-line'
        },
        {
          icon: 'account_tree',
          label: t('config.appSettings.historyTimelineMode.node'),
          value: 'node'
        }
      ]}
    />
  )
}

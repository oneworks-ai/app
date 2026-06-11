import '../ConfigView.scss'

import { InputNumber, Switch } from 'antd'
import { useAtom, useSetAtom } from 'jotai'
import type { ReactNode } from 'react'

import {
  interactionPanelPinnedTabLimitAtom,
  normalizeThemeMode,
  senderHeaderDisplayAtom,
  sessionListSearchThresholdAtom,
  showAnnouncementsAtom,
  showNewSessionStarterListAtom,
  themeAtom
} from '#~/store/index.js'
import type { SenderHeaderDisplayMode, ThemeMode } from '#~/store/index.js'

import { MobileAwareSelect as Select } from '#~/components/mobile-aware-select/MobileAwareSelect'
import { useResolvedThemeMode } from '#~/hooks/use-resolved-theme-mode'
import { FieldRow } from './ConfigFieldRow'
import { ConfigSectionFrame } from './ConfigSectionFrame'
import { ProjectThemeColorSettings } from './ProjectThemeColorSettings'
import { ThemeModeRadioGroup } from './ThemeModeRadioGroup'
import type { TranslationFn } from './configUtils'

export function AppSettingsPanel({
  appearance,
  headerExtra,
  headerLeading,
  onAppearanceChange,
  showHeader = true,
  t
}: {
  appearance: Record<string, unknown>
  headerExtra?: ReactNode
  headerLeading?: ReactNode
  onAppearanceChange: (value: Record<string, unknown>) => void
  showHeader?: boolean
  t: TranslationFn
}) {
  const setThemeMode = useSetAtom(themeAtom)
  const themeMode = normalizeThemeMode(appearance.themeMode)
  const { resolvedThemeMode } = useResolvedThemeMode()
  const [showAnnouncements, setShowAnnouncements] = useAtom(showAnnouncementsAtom)
  const [showNewSessionStarterList, setShowNewSessionStarterList] = useAtom(showNewSessionStarterListAtom)
  const [senderHeaderDisplay, setSenderHeaderDisplay] = useAtom(senderHeaderDisplayAtom)
  const [sessionListSearchThreshold, setSessionListSearchThreshold] = useAtom(sessionListSearchThresholdAtom)
  const [interactionPanelPinnedTabLimit, setInteractionPanelPinnedTabLimit] = useAtom(
    interactionPanelPinnedTabLimitAtom
  )
  const handleThemeModeChange = (nextThemeMode: ThemeMode) => {
    setThemeMode(nextThemeMode)
    onAppearanceChange({
      ...appearance,
      themeMode: nextThemeMode
    })
  }

  return (
    <ConfigSectionFrame
      headerExtra={showHeader ? headerExtra : undefined}
      headerLeading={showHeader ? headerLeading : undefined}
      icon={showHeader ? 'tune' : undefined}
      title={showHeader ? t('config.sections.appearance') : undefined}
    >
      <div className='config-view__app-settings-list'>
        <div className='config-view__app-settings-group'>
          <ProjectThemeColorSettings
            appearance={appearance}
            iconAppearance={themeMode}
            iconMode={resolvedThemeMode}
            t={t}
            onAppearanceChange={onAppearanceChange}
          />
          <FieldRow
            title={t('config.appSettings.themeMode.label')}
            description={t('config.appSettings.themeMode.desc')}
            icon='dark_mode'
          >
            <ThemeModeRadioGroup
              value={themeMode}
              onChange={handleThemeModeChange}
              t={t}
            />
          </FieldRow>
        </div>
        <FieldRow
          title={t('config.appSettings.senderHeaderDisplay.label')}
          description={t('config.appSettings.senderHeaderDisplay.desc')}
          icon='unfold_more'
        >
          <Select<SenderHeaderDisplayMode>
            value={senderHeaderDisplay}
            onChange={setSenderHeaderDisplay}
            options={[
              {
                value: 'expanded',
                label: t('config.appSettings.senderHeaderDisplay.expanded')
              },
              {
                value: 'collapsed',
                label: t('config.appSettings.senderHeaderDisplay.collapsed')
              }
            ]}
          />
        </FieldRow>
        <FieldRow
          title={t('config.appSettings.sessionListSearchThreshold.label')}
          description={t('config.appSettings.sessionListSearchThreshold.desc')}
          icon='search'
        >
          <InputNumber
            min={0}
            precision={0}
            value={sessionListSearchThreshold}
            onChange={(value) => setSessionListSearchThreshold(value ?? 0)}
          />
        </FieldRow>
        <FieldRow
          title={t('config.appSettings.interactionPanelPinnedTabLimit.label')}
          description={t('config.appSettings.interactionPanelPinnedTabLimit.desc')}
          icon='keep'
        >
          <InputNumber
            min={0}
            max={12}
            precision={0}
            value={interactionPanelPinnedTabLimit}
            onChange={(value) => setInteractionPanelPinnedTabLimit(value ?? 4)}
          />
        </FieldRow>
        <div className='config-view__app-settings-group'>
          <FieldRow
            title={t('config.appSettings.announcements.label')}
            description={t('config.appSettings.announcements.desc')}
            icon='campaign'
          >
            <Switch checked={showAnnouncements} onChange={setShowAnnouncements} />
          </FieldRow>
          <FieldRow
            title={t('config.appSettings.recommendedActions.label')}
            description={t('config.appSettings.recommendedActions.desc')}
            icon='tips_and_updates'
          >
            <Switch checked={showNewSessionStarterList} onChange={setShowNewSessionStarterList} />
          </FieldRow>
        </div>
      </div>
    </ConfigSectionFrame>
  )
}

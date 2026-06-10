import { Button, Dropdown } from 'antd'
import type { MenuProps } from 'antd'
import { useAtom } from 'jotai'
import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import useSWR from 'swr'

import type { ConfigResponse } from '@oneworks/types'

import { getConfig, updateConfig } from '#~/api'
import { MaterialSymbol } from '#~/components/icons/MaterialSymbol'
import { useInterfaceLanguageConfig } from '#~/hooks/use-interface-language-config'
import { themeAtom } from '#~/store'
import type { ThemeMode } from '#~/store'
import { buildLanguageItems, buildThemeItems } from '../nav-rail-items'

export function SidebarUtilityFooter() {
  const { t, i18n } = useTranslation()
  const [themeMode, setThemeMode] = useAtom(themeAtom)
  const navigate = useNavigate()
  const { updateGlobalInterfaceLanguage } = useInterfaceLanguageConfig()
  const { data: configRes, mutate: mutateConfig } = useSWR<ConfigResponse>('/api/config', getConfig)

  const updateGlobalThemeMode = useCallback((nextThemeMode: ThemeMode) => {
    const previousThemeMode = themeMode
    setThemeMode(nextThemeMode)

    void updateConfig('global', 'appearance', {
      ...(configRes?.sources?.global?.appearance ?? {}),
      themeMode: nextThemeMode
    })
      .then(() => mutateConfig())
      .catch((error) => {
        console.error('[sidebar] failed to update global theme mode', error)
        setThemeMode(previousThemeMode)
        void mutateConfig()
      })
  }, [configRes?.sources?.global?.appearance, mutateConfig, setThemeMode, themeMode])

  const languageItems: MenuProps['items'] = useMemo(() =>
    buildLanguageItems({
      currentLanguage: i18n.language,
      onChangeLanguage: updateGlobalInterfaceLanguage
    }), [i18n.language, updateGlobalInterfaceLanguage])

  const themeItems: MenuProps['items'] = useMemo(() =>
    buildThemeItems({
      setThemeMode: updateGlobalThemeMode,
      t,
      themeMode
    }), [t, themeMode, updateGlobalThemeMode])

  return (
    <div className='sidebar-utility-footer'>
      <Dropdown
        menu={{ items: themeItems, triggerSubMenuAction: 'click' }}
        placement='topLeft'
        trigger={['click']}
      >
        <Button
          type='text'
          className='sidebar-utility-footer__action'
          icon={
            <MaterialSymbol
              name={themeMode === 'light' ? 'light_mode' : themeMode === 'dark' ? 'dark_mode' : 'desktop_windows'}
            />
          }
        >
          <span>{t('common.theme')}</span>
        </Button>
      </Dropdown>

      <Dropdown
        menu={{ items: languageItems, triggerSubMenuAction: 'click' }}
        placement='topLeft'
        trigger={['click']}
      >
        <Button
          type='text'
          className='sidebar-utility-footer__action'
          icon={<MaterialSymbol name='language' />}
        >
          <span>{t('common.language')}</span>
        </Button>
      </Dropdown>

      <Button
        type='text'
        className='sidebar-utility-footer__action'
        icon={<MaterialSymbol name='settings' />}
        onClick={() => void navigate('/config')}
      >
        <span>{t('common.settings')}</span>
      </Button>
    </div>
  )
}

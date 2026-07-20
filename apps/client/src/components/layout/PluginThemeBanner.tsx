import './PluginThemeBanner.scss'

import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { createPluginI18nContext } from '#~/plugins/plugin-i18n'
import type { PluginI18nText } from '#~/plugins/plugin-i18n'
import type { PluginThemeBannerRegistration } from '#~/plugins/plugin-theme-contract'

const normalizeBannerItems = (value: unknown): PluginI18nText[] => {
  if (value == null) return []
  return Array.isArray(value) ? value : [value as PluginI18nText]
}

export function PluginThemeBanner({
  banner,
  isDarkMode,
  reserveWindowControls = false
}: {
  banner: PluginThemeBannerRegistration
  isDarkMode: boolean
  reserveWindowControls?: boolean
}) {
  const { i18n } = useTranslation()
  const pluginI18n = useMemo(() => createPluginI18nContext(), [i18n.resolvedLanguage])
  const text = (value: PluginI18nText) => pluginI18n.resolveText(value)
  const mark = banner.brand?.markUrl
  const markUrl = typeof mark === 'string'
    ? mark
    : (mark == null ? undefined : (isDarkMode ? mark.dark : mark.light))
  const hasBrand = banner.brand != null
  const topline = normalizeBannerItems(banner.topline)
  const ribbon = normalizeBannerItems(banner.ribbon)

  return (
    <header
      className={`theme-pack-banner${isDarkMode ? ' theme-pack-banner--dark' : ''}${
        reserveWindowControls ? ' theme-pack-banner--window-controls-reserved' : ''
      }${hasBrand ? ' theme-pack-banner--with-brand' : ''}`}
      aria-label={text(banner.ariaLabel)}
    >
      <img className='theme-pack-banner__artwork' src={banner.artworkUrl} alt='' />
      <div className='theme-pack-banner__topline' aria-hidden='true'>
        {topline.map((item, index) => <span key={index}>{text(item)}</span>)}
      </div>
      <div className='theme-pack-banner__main'>
        {banner.brand != null && (
          <div className='theme-pack-banner__brand'>
            {markUrl != null && (
              <span className='theme-pack-banner__mark-frame'>
                <img className='theme-pack-banner__mark' src={markUrl} alt='' />
              </span>
            )}
            <div className='theme-pack-banner__brand-copy'>
              {banner.brand.eyebrow != null && (
                <span className='theme-pack-banner__eyebrow'>{text(banner.brand.eyebrow)}</span>
              )}
              <strong>{text(banner.brand.name)}</strong>
              {banner.brand.tagline != null && <small>{text(banner.brand.tagline)}</small>}
            </div>
          </div>
        )}
        <div className='theme-pack-banner__center'>
          <span className='theme-pack-banner__title-ornament' aria-hidden='true'>◆</span>
          <strong>{text(banner.title)}</strong>
          {banner.subtitle != null && <small>{text(banner.subtitle)}</small>}
          {banner.slogan != null && <span className='theme-pack-banner__slogan'>{text(banner.slogan)}</span>}
        </div>
      </div>
      {ribbon.length > 0 && (
        <div className='theme-pack-banner__ribbon' aria-hidden='true'>
          {ribbon.map((item, index) => (
            <span key={index} className='theme-pack-banner__ribbon-item'>
              {index > 0 && <i />}
              <span>{text(item)}</span>
            </span>
          ))}
        </div>
      )}
    </header>
  )
}

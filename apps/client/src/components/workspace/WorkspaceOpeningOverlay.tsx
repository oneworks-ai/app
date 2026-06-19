import './WorkspaceOpeningOverlay.scss'

import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'

import { mountOneWorksIconLoader } from '@oneworks/icon/loader'
import type { OneWorksIconLoaderHandle, OneWorksIconLoaderOptions } from '@oneworks/icon/loader'

const workspaceOpeningIconSeed = 'desktop-workspace-startup'
const workspaceOpeningTipIntervalMs = 3200
const workspaceOpeningTipKeys = [
  'quickFind',
  'dragFiles',
  'newWindow',
  'slashCommand',
  'sidePanel',
  'terminal',
  'context',
  'glass'
] as const

interface WorkspaceOpeningOverlayProps {
  appearance: NonNullable<OneWorksIconLoaderOptions['appearance']>
  phase?: 'exiting' | 'visible'
  subtitle?: string
  title: string
}

export function WorkspaceOpeningOverlay({
  appearance,
  phase = 'visible',
  subtitle,
  title
}: WorkspaceOpeningOverlayProps) {
  const { t } = useTranslation()
  const iconHostRef = useRef<HTMLDivElement>(null)
  const iconHandleRef = useRef<OneWorksIconLoaderHandle | null>(null)
  const [tipIndex, setTipIndex] = useState(0)
  const [fallbackIconVisible, setFallbackIconVisible] = useState(false)

  const tips = useMemo(() => workspaceOpeningTipKeys.map(key => t(`desktopStartupOverlay.tips.${key}`)), [t])
  const currentTip = tips[tipIndex % tips.length] ?? t('desktopStartupOverlay.defaultTip')

  useEffect(() => {
    const host = iconHostRef.current
    if (host == null || iconHandleRef.current != null) return

    try {
      iconHandleRef.current = mountOneWorksIconLoader(host, {
        appearance,
        background: 'transparent',
        canvasClassName: 'workspace-opening-overlay__icon-canvas',
        className: 'workspace-opening-overlay__icon-loader',
        motion: true,
        random: false,
        seed: workspaceOpeningIconSeed,
        shadow: false,
        theme: 'metal'
      })
      setFallbackIconVisible(false)
    } catch (error) {
      setFallbackIconVisible(true)
      console.warn('[workspace-opening] failed to mount opening animation', error)
    }

    return () => {
      iconHandleRef.current?.dispose()
      iconHandleRef.current = null
    }
  }, [appearance])

  useEffect(() => {
    iconHandleRef.current?.update({ appearance })
  }, [appearance])

  useEffect(() => {
    setTipIndex(0)
    const intervalId = window.setInterval(() => {
      setTipIndex(index => index + 1)
    }, workspaceOpeningTipIntervalMs)

    return () => window.clearInterval(intervalId)
  }, [subtitle])

  return createPortal(
    <div
      className={[
        'workspace-opening-overlay',
        phase === 'exiting' ? 'is-exiting' : 'is-visible'
      ].join(' ')}
      data-phase={phase}
      role='status'
      aria-live='polite'
      aria-busy='true'
    >
      <div className='workspace-opening-overlay__content'>
        <div
          ref={iconHostRef}
          className={[
            'workspace-opening-overlay__icon',
            fallbackIconVisible ? 'is-fallback' : ''
          ].filter(Boolean).join(' ')}
          aria-label={t('launcher.openingProjectAnimationLabel')}
          role='img'
        >
          <img
            className='workspace-opening-overlay__icon-fallback workspace-opening-overlay__icon-fallback--light'
            src='/favicon-metal-light.svg'
            alt=''
            draggable={false}
          />
          <img
            className='workspace-opening-overlay__icon-fallback workspace-opening-overlay__icon-fallback--dark'
            src='/favicon-metal-dark.svg'
            alt=''
            draggable={false}
          />
        </div>
        <div className='workspace-opening-overlay__copy'>
          <p className='workspace-opening-overlay__eyebrow'>{t('desktopStartupOverlay.eyebrow')}</p>
          <h2 className='workspace-opening-overlay__title'>{title}</h2>
          {subtitle != null && subtitle.trim() !== '' && (
            <p className='workspace-opening-overlay__subtitle' title={subtitle}>{subtitle}</p>
          )}
        </div>
      </div>
      <p className='workspace-opening-overlay__tip'>{currentTip}</p>
    </div>,
    document.body
  )
}

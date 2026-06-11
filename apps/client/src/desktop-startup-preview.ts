import { mountOneWorksIconLoader } from '@oneworks/icon/loader'
import type { OneWorksIconLoaderOptions } from '@oneworks/icon/loader'

const startupIconSelector = '[data-oneworks-desktop-startup-icon="true"]'
const startupIconSeed = 'desktop-workspace-startup'

type StartupAppearance = 'system' | 'light' | 'dark'

const normalizeStartupAppearance = (value: unknown): StartupAppearance => {
  if (value === 'light' || value === 'dark') return value
  return 'system'
}

const buildStartupIconOptions = (): OneWorksIconLoaderOptions => ({
  appearance: normalizeStartupAppearance(document.documentElement.dataset.oneworksDesktopStartupTheme),
  background: 'transparent',
  canvasClassName: 'oneworks-desktop-startup-overlay__icon-canvas',
  className: 'oneworks-desktop-startup-overlay__icon-loader',
  motion: true,
  random: false,
  seed: startupIconSeed,
  shadow: false,
  theme: 'metal'
})

const mountStartupPreviewIcon = () => {
  if (document.documentElement.dataset.oneworksDesktopStartupPreview !== 'true') return

  const host = document.querySelector<HTMLElement>(startupIconSelector)
  if (host == null || host.dataset.mounted === 'true') return

  try {
    host.dataset.mounted = 'true'
    mountOneWorksIconLoader(host, buildStartupIconOptions())
    delete document.documentElement.dataset.oneworksDesktopStartupFallbackIcon
  } catch (error) {
    delete host.dataset.mounted
    document.documentElement.dataset.oneworksDesktopStartupFallbackIcon = 'true'
    console.warn('[desktop-startup-preview] failed to mount startup icon', error)
  }
}

mountStartupPreviewIcon()

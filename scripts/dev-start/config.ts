import type { DevStartOptions, DevStartTarget, TargetConfig } from './types'

export const getTargetConfig = (
  target: DevStartTarget,
  options: Pick<DevStartOptions, 'workspace'> = {}
): TargetConfig => {
  if (target === 'web') {
    return {
      base: '/ui',
      clientMode: 'dev',
      defaultClientPort: 5173,
      defaultServerPort: 8787,
      needsClient: true,
      needsServer: true,
      readiness: 'http',
      serverRole: 'manager',
      urlSuffix: 'launcher'
    }
  }

  if (target === 'pwa') {
    return {
      base: '/pwa/',
      buildClient: true,
      clientMode: 'standalone',
      defaultClientPort: 4173,
      defaultServerPort: 8787,
      needsClient: true,
      needsServer: true,
      readiness: 'http',
      urlSuffix: ''
    }
  }

  if (target === 'homepage') {
    return {
      base: '/',
      clientMode: 'standalone',
      defaultClientPort: 4321,
      defaultServerPort: 4173,
      extraEnv: {
        __ONEWORKS_PROJECT_CLIENT_HOMEPAGE_PREVIEW__: '1'
      },
      needsClient: true,
      needsServer: true,
      readiness: 'client',
      urlSuffix: ''
    }
  }

  if (target === 'docs') {
    return {
      defaultClientPort: 4317,
      needsClient: false,
      needsServer: false,
      readiness: 'docs'
    }
  }

  return {
    desktopWorkspace: target === 'electron-workspace' || options.workspace === true,
    needsClient: false,
    needsServer: false,
    readiness: 'process'
  }
}

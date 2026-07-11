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
      kind: 'standard',
      needsClient: true,
      needsServer: true,
      readiness: 'http',
      serverRole: 'manager',
      urlSuffix: 'launcher'
    }
  }

  if (target === 'daemon') {
    return {
      defaultServerPort: 8787,
      kind: 'standard',
      needsClient: false,
      needsServer: true,
      readiness: 'http',
      serverRole: 'manager'
    }
  }

  if (target === 'pwa') {
    return {
      base: '/pwa/',
      buildClient: true,
      clientMode: 'standalone',
      defaultClientPort: 4173,
      defaultServerPort: 8787,
      kind: 'standard',
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
      kind: 'standard',
      needsClient: true,
      needsServer: true,
      readiness: 'client',
      urlSuffix: ''
    }
  }

  if (target === 'docs') {
    return {
      defaultClientPort: 4317,
      kind: 'standard',
      needsClient: false,
      needsServer: false,
      readiness: 'docs'
    }
  }

  if (target === 'relay') {
    return {
      defaultClientPort: 5173,
      defaultServerPort: 48888,
      kind: 'relay',
      needsClient: true,
      needsServer: true,
      readiness: 'http'
    }
  }

  if (target === 'desktop-control') {
    return {
      defaultServerPort: 9777,
      kind: 'desktop-control',
      needsClient: false,
      needsServer: true,
      readiness: 'http'
    }
  }

  if (target === 'android-emulator') {
    return {
      kind: 'android-emulator',
      needsClient: false,
      needsServer: false,
      readiness: 'device'
    }
  }

  return {
    desktopWorkspace: target === 'electron-workspace' || options.workspace === true,
    kind: 'desktop',
    needsClient: false,
    needsServer: false,
    readiness: 'process'
  }
}

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

const readRepoFile = (path: string) => readFile(join(process.cwd(), path), 'utf8')

describe('launcher plugin boundary', () => {
  it('keeps plugin-owned account entries out of the core launcher route', async () => {
    const source = await readRepoFile('apps/client/src/routes/LauncherRoute.tsx')

    expect(source).not.toContain('builtin:account')
    expect(source).not.toContain("openLauncherView('account')")
    expect(source).not.toContain("launcherViewMode === 'account'")
    expect(source).not.toContain("type LauncherViewMode = 'about' | 'account'")
    expect(source).not.toContain('createLauncherRelayLoginUrl')
    expect(source).not.toContain('readLauncherRelayAccounts')
    expect(source).not.toContain('relayAccountSections')
  })

  it('keeps the relay launcher account entry registered by plugin contributions', async () => {
    const manifest = JSON.parse(await readRepoFile('packages/plugins/relay/package.json')) as {
      plugin?: {
        contributions?: {
          launcherSearchProviders?: Array<{ id?: string; surfaces?: string[] }>
          routes?: Array<{ id?: string; surfaces?: string[] }>
        }
      }
    }
    const relayClient = await readRepoFile('packages/plugins/relay/src/client/index.ts')
    const relayI18n = await readRepoFile('packages/plugins/relay/src/client/i18n.ts')

    expect(
      manifest.plugin?.contributions?.routes?.some(route => route.id === 'home' && route.surfaces?.includes('launcher'))
    ).toBe(true)
    expect(
      manifest.plugin?.contributions?.launcherSearchProviders?.some(provider =>
        provider.id === 'relay' && provider.surfaces?.includes('launcher')
      )
    ).toBe(true)
    expect(relayClient).toContain("ctx.commands.register('search'")
    expect(relayClient).toContain("groupId: 'account'")
    expect(relayClient).toContain('accounts.length > 1')
    expect(relayClient).toContain('accountListTitle')
    expect(relayClient).toContain('loginMoreTitle')
    expect(relayClient).not.toContain("id: 'status'")
    expect(relayClient).not.toContain('badge: signedIn')
    expect(relayI18n).toContain('账号列表')
    expect(relayI18n).toContain('登录更多账号')
    expect(relayI18n).not.toContain('账号状态')
  })

  it('keeps host-owned directory browser pages on explicit launcher routes', async () => {
    const source = await readRepoFile('apps/client/src/routes/LauncherRoute.tsx')
    const routeGuide = await readRepoFile('apps/client/src/routes/AGENTS.md')

    expect(source).toContain('buildLauncherViewRoutePath')
    expect(source).toContain('`/launcher/${mode}`')
    expect(source).toContain('readLauncherViewModeFromLocation')
    expect(routeGuide).toContain('/launcher/settings')
    expect(routeGuide).toContain('/launcher/about')
    expect(source).toContain("segments[1] !== 'browse'")
    expect(source).toContain('buildLauncherDirectoryRoutePath')
    expect(source).toContain('`/launcher/browse/${encodeLauncherPathSegment(mode)}')
    expect(source).toContain('${encodeLauncherPathSegment(normalizedDirectory)}')
    expect(source).toContain('LAUNCHER_DIRECTORY_PATH_SEARCH_PARAM')
    expect(routeGuide).toContain('/launcher/browse/:mode/:targetId/:path')
  })
})

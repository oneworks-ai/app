import { ensureDriver, getDriverStatus } from './driver.js'
import type { CuaPluginContext } from './types.js'

const isRecord = (value: unknown): value is Record<string, unknown> => (
  value != null && typeof value === 'object' && !Array.isArray(value)
)

const launcherItems = [
  {
    id: 'status',
    title: 'Computer control status',
    description: 'Check whether macOS computer control is ready.',
    icon: 'desktop_mac',
    badge: 'cua',
    keywords: ['cua', 'driver', 'status', 'computer use']
  },
  {
    id: 'ensure',
    title: 'Prepare computer control',
    description: 'Set up computer control and guide any required macOS permissions.',
    icon: 'play_circle',
    badge: 'cua',
    keywords: ['cua', 'driver', 'install', 'ensure', 'permissions']
  }
]

export const searchLauncher = async (ctx: CuaPluginContext, payload: unknown = {}) => {
  const source = isRecord(payload) ? payload : {}
  const action = typeof source.action === 'string' ? source.action : undefined
  const itemId = typeof source.itemId === 'string' ? source.itemId : undefined
  if (action === 'invoke' && itemId === 'status') {
    return await getDriverStatus({ checkDaemon: true })
  }
  if (action === 'invoke' && itemId === 'ensure') {
    return await ensureDriver(ctx)
  }

  const query = typeof source.query === 'string' ? source.query.trim().toLowerCase() : ''
  return query === ''
    ? launcherItems
    : launcherItems.filter(item =>
      [item.title, item.description, ...item.keywords].some(value => value.toLowerCase().includes(query))
    )
}

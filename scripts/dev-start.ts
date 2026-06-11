import { mkdirSync } from 'node:fs'

import { runMain } from './dev-start/manager'
import { logDir } from './dev-start/paths'
import { runServiceChild } from './dev-start/service-child'
import type { DevStartOptions } from './dev-start/types'

export { type DevStartOptions, type DevStartTarget, devStartTargets, parseDevStartTarget } from './dev-start/types'

export const runDevStart = async ({
  serviceChild = false,
  target = 'web',
  workspace = false
}: DevStartOptions = {}) => {
  mkdirSync(logDir, { recursive: true })
  if (serviceChild) {
    await runServiceChild(target)
    return
  }
  await runMain(target, { workspace })
}

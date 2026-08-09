import { exit } from 'node:process'

import { startServer } from './start-server'
import { logger } from './utils/logger'

startServer().catch((err) => {
  logger.error({ err }, '[server] bootstrap failed')
  exit(1)
})

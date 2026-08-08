import { compose } from '#~/utils/compose.js'

import type { ChannelContext } from './@types'

import { accessControlMiddleware } from './access-control'
import { ackMiddleware } from './ack'
import { adminBootstrapMiddleware } from './admin-bootstrap'
import { adminGateMiddleware } from './admin-gate'
import { availabilityGateMiddleware } from './availability-gate'
import { bindSessionMiddleware } from './bind-session'
import { channelCommandMiddleware } from './commands'
import { deduplicateMiddleware } from './deduplicate'
import { dispatchMiddleware } from './dispatch'
import { emojiRegistryMiddleware } from './emoji-registry'
import { groupMessageDebounceMiddleware } from './group-message-debounce'
import { i18nMiddleware } from './i18n'
import { identityMiddleware } from './identity'
import { ingressGateMiddleware } from './ingress-gate'
import { interactionResponseMiddleware } from './interaction-response'
import { parseContentMiddleware } from './parse-content'
import { resolveSessionMiddleware } from './resolve-session'

export const pipeline = compose<ChannelContext>(
  deduplicateMiddleware,
  i18nMiddleware,
  parseContentMiddleware,
  identityMiddleware,
  adminBootstrapMiddleware,
  accessControlMiddleware,
  emojiRegistryMiddleware,
  resolveSessionMiddleware,
  channelCommandMiddleware,
  interactionResponseMiddleware,
  availabilityGateMiddleware,
  ingressGateMiddleware,
  groupMessageDebounceMiddleware,
  ackMiddleware,
  adminGateMiddleware,
  dispatchMiddleware,
  bindSessionMiddleware
)

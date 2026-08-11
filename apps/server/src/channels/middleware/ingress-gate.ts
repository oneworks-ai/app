import type { ChannelMiddleware } from './@types'

export const ingressGateMiddleware: ChannelMiddleware = async (ctx, next) => {
  // Router owns every final ingress decision so ignored linked messages remain auditable.
  await next()
}

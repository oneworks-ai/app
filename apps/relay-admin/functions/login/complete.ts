import { proxyRelayRequest } from '../../src/platform/relayProxy'

export const onRequest = async ({ env, request }: { env: Record<string, unknown>; request: Request }) =>
  await proxyRelayRequest(request, '/login/complete', env)

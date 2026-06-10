import { loadEnv } from '@oneworks/core'

export class MissingChannelActionSecretError extends Error {
  constructor() {
    super('Missing __ONEWORKS_PROJECT_SERVER_ACTION_SECRET__')
    this.name = 'MissingChannelActionSecretError'
  }
}

export const resolveActionTokenSecret = () => {
  const env = loadEnv()
  const configuredSecret = env.__ONEWORKS_PROJECT_SERVER_ACTION_SECRET__?.trim()
  if (configuredSecret != null && configuredSecret !== '') {
    return configuredSecret
  }

  throw new MissingChannelActionSecretError()
}

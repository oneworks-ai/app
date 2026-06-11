import { getRuntimeEnv } from '#~/runtime-config'

const pickNonEmptyValue = (...values: Array<string | undefined>) => (
  values.find((value) => typeof value === 'string' && value.trim() !== '')
)

export const getClientVersion = () => (
  pickNonEmptyValue(
    getRuntimeEnv().__ONEWORKS_PROJECT_CLIENT_VERSION__,
    import.meta.env.__ONEWORKS_PROJECT_CLIENT_VERSION__
  ) ?? '0.0.0'
)

export const getClientCommitHash = () => (
  pickNonEmptyValue(
    getRuntimeEnv().__ONEWORKS_PROJECT_CLIENT_COMMIT_HASH__,
    import.meta.env.__ONEWORKS_PROJECT_CLIENT_COMMIT_HASH__
  )
)

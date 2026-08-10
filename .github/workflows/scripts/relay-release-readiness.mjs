const defaultSleep = async milliseconds => await new Promise(resolve => setTimeout(resolve, milliseconds))

const errorMessage = error => error instanceof Error ? error.message : String(error)

export function assertExpectedRelayHealth(
  payload,
  { expectedBuildSha = '', expectedVersion = '' } = {},
  label = '/health'
) {
  if (payload?.ok !== true) {
    throw new Error(`${label} did not return ok=true: ${JSON.stringify(payload)}`)
  }
  if (expectedVersion !== '' && payload.version !== expectedVersion) {
    throw new Error(
      `${label}.version should be "${expectedVersion}", got "${String(payload.version ?? '')}".`
    )
  }
  if (expectedBuildSha !== '' && payload.buildSha !== expectedBuildSha) {
    throw new Error(
      `${label}.buildSha should be "${expectedBuildSha}", got "${String(payload.buildSha ?? '')}".`
    )
  }
}

export async function waitForExpectedRelayHealth({
  attempts = 1,
  expectedBuildSha = '',
  expectedVersion = '',
  fetchHealth,
  intervalMs = 20_000,
  onRetry = () => {},
  sleep = defaultSleep
}) {
  if (!Number.isInteger(attempts) || attempts < 1) {
    throw new Error('Relay readiness attempts must be a positive integer.')
  }
  if (!Number.isFinite(intervalMs) || intervalMs < 0) {
    throw new Error('Relay readiness interval must be a non-negative number.')
  }

  let lastError
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const health = await fetchHealth()
      assertExpectedRelayHealth(health, { expectedBuildSha, expectedVersion })
      return health
    } catch (error) {
      lastError = error
      if (attempt === attempts) break
      onRetry({ attempt, attempts, error })
      await sleep(intervalMs)
    }
  }

  throw new Error(
    `Relay release did not become ready after ${attempts} attempt(s): ${errorMessage(lastError)}`,
    { cause: lastError }
  )
}

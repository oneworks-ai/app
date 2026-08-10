export interface RelayHealthExpectation {
  expectedBuildSha?: string
  expectedVersion?: string
}

export interface RelayReadinessRetry {
  attempt: number
  attempts: number
  error: unknown
}

export function assertExpectedRelayHealth(
  payload: unknown,
  expectation?: RelayHealthExpectation,
  label?: string
): void

export function waitForExpectedRelayHealth(
  input: RelayHealthExpectation & {
    attempts?: number
    fetchHealth: () => Promise<unknown>
    intervalMs?: number
    onRetry?: (retry: RelayReadinessRetry) => void
    sleep?: (milliseconds: number) => Promise<void>
  }
): Promise<unknown>

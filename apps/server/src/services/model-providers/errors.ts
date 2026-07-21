export class ModelProvidersServiceError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly details?: unknown
  ) {
    super(message)
    this.name = 'ModelProvidersServiceError'
  }
}

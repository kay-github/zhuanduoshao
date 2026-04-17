export class ConfigurationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ConfigurationError'
  }
}

export function isConfigurationError(error: unknown): error is ConfigurationError {
  return error instanceof ConfigurationError
}

export class ConfigurationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ConfigurationError'
  }
}

export function isConfigurationError(error: unknown): error is ConfigurationError {
  return error instanceof ConfigurationError
}

export function isPostgresUniqueViolation(error: unknown) {
  let currentError: unknown = error

  for (let depth = 0; depth < 4; depth += 1) {
    if (!currentError || typeof currentError !== 'object') {
      return false
    }

    if ('code' in currentError && currentError.code === '23505') {
      return true
    }

    currentError = 'cause' in currentError ? currentError.cause : null
  }

  return false
}

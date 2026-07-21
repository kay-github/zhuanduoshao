export const DISABLE_MARKET_DATA_PERSISTENCE_ENV = 'DISABLE_MARKET_DATA_PERSISTENCE'

export function isMarketDataPersistenceDisabled() {
  return process.env[DISABLE_MARKET_DATA_PERSISTENCE_ENV] === '1'
}

export async function forEachBestEffort<T>(
  items: readonly T[],
  operation: (item: T) => Promise<void>,
  onError: (error: unknown, item: T) => void,
) {
  for (const item of items) {
    try {
      await operation(item)
    } catch (error) {
      onError(error, item)
    }
  }
}

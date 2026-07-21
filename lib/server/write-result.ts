type RowParser<T> = (value: unknown) => T | null

function readFirstRow(value: unknown) {
  if (Array.isArray(value)) {
    return value[0]
  }

  if (value && typeof value === 'object' && 'rows' in value && Array.isArray(value.rows)) {
    return value.rows[0]
  }

  return undefined
}

export async function resolveWrittenRow<T>(
  writeResult: unknown,
  parseRow: RowParser<T>,
  readAfterWrite: () => Promise<unknown>,
): Promise<T | null> {
  // Drizzle normally returns an array. Anything else is treated as an
  // unconfirmed write result and verified through a fresh, scoped read.
  const returnedRow = Array.isArray(writeResult) ? parseRow(writeResult[0]) : null

  if (returnedRow !== null) {
    return returnedRow
  }

  return parseRow(readFirstRow(await readAfterWrite()))
}

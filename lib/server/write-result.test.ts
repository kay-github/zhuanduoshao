import { describe, expect, it, vi } from 'vitest'

import { resolveWrittenRow } from './write-result.js'

interface TestRow {
  id: string
}

function parseTestRow(value: unknown): TestRow | null {
  if (!value || typeof value !== 'object' || !('id' in value) || typeof value.id !== 'string') {
    return null
  }

  return { id: value.id }
}

describe('resolveWrittenRow', () => {
  it('uses a valid standard returning row without another read', async () => {
    const readAfterWrite = vi.fn(async () => [{ id: 'fallback' }])

    await expect(resolveWrittenRow([{ id: 'returned' }], parseTestRow, readAfterWrite)).resolves.toEqual({
      id: 'returned',
    })
    expect(readAfterWrite).not.toHaveBeenCalled()
  })

  it.each([undefined, [], [{}], { rows: [{ id: 'driver-shaped' }] }])(
    'performs a scoped read for a missing or unexpected write result: %j',
    async (writeResult) => {
      const readAfterWrite = vi.fn(async () => [{ id: 'confirmed' }])

      await expect(resolveWrittenRow(writeResult, parseTestRow, readAfterWrite)).resolves.toEqual({ id: 'confirmed' })
      expect(readAfterWrite).toHaveBeenCalledOnce()
    },
  )

  it('understands a driver rows wrapper returned by the verification read', async () => {
    await expect(
      resolveWrittenRow(undefined, parseTestRow, async () => ({ rows: [{ id: 'confirmed' }] })),
    ).resolves.toEqual({ id: 'confirmed' })
  })

  it('returns null when the verification read cannot confirm a valid row', async () => {
    await expect(resolveWrittenRow([{}], parseTestRow, async () => [])).resolves.toBeNull()
  })
})

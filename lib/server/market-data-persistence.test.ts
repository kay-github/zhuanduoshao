import { describe, expect, it, vi } from 'vitest'

import { forEachBestEffort } from './market-data-persistence.js'

describe('forEachBestEffort', () => {
  it('continues with later items after one operation fails', async () => {
    const attempted: number[] = []
    const onError = vi.fn()

    await forEachBestEffort(
      [1, 2, 3],
      async (item) => {
        attempted.push(item)

        if (item === 1) {
          throw new Error('first item failed')
        }
      },
      onError,
    )

    expect(attempted).toEqual([1, 2, 3])
    expect(onError).toHaveBeenCalledTimes(1)
    expect(onError.mock.calls[0]?.[1]).toBe(1)
  })
})

import { describe, expect, it } from 'vitest'

import { createRateLimiter } from './rate-limit.js'

function createClock(startMs = 0) {
  let nowMs = startMs
  return {
    now: () => nowMs,
    advance(ms: number) {
      nowMs += ms
    },
  }
}

describe('createRateLimiter', () => {
  it('does not limit a key before the failure budget is spent', () => {
    const limiter = createRateLimiter(3, 1_000, createClock().now)

    expect(limiter.isLimited('ip-1')).toBe(false)
    limiter.recordFailure('ip-1')
    limiter.recordFailure('ip-1')
    expect(limiter.isLimited('ip-1')).toBe(false)
  })

  it('limits a key once failures reach the budget within the window', () => {
    const limiter = createRateLimiter(3, 1_000, createClock().now)

    limiter.recordFailure('ip-1')
    limiter.recordFailure('ip-1')
    limiter.recordFailure('ip-1')

    expect(limiter.isLimited('ip-1')).toBe(true)
    expect(limiter.isLimited('ip-2')).toBe(false)
  })

  it('expires the window so the key recovers after windowMs', () => {
    const clock = createClock()
    const limiter = createRateLimiter(2, 1_000, clock.now)

    limiter.recordFailure('ip-1')
    limiter.recordFailure('ip-1')
    expect(limiter.isLimited('ip-1')).toBe(true)

    clock.advance(1_001)
    expect(limiter.isLimited('ip-1')).toBe(false)

    // A new failure after expiry starts a fresh window instead of piling on.
    limiter.recordFailure('ip-1')
    expect(limiter.isLimited('ip-1')).toBe(false)
  })

  it('reset clears the counter, matching a successful login', () => {
    const limiter = createRateLimiter(2, 1_000, createClock().now)

    limiter.recordFailure('ip-1')
    limiter.recordFailure('ip-1')
    expect(limiter.isLimited('ip-1')).toBe(true)

    limiter.reset('ip-1')
    expect(limiter.isLimited('ip-1')).toBe(false)
  })
})

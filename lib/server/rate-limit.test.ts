import { describe, expect, it } from 'vitest'

import {
  AUTH_RATE_LIMIT_NAMESPACES,
  buildAuthRateLimitKey,
  createRateLimiter,
} from './rate-limit.js'

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

  it('keeps login IP, login username, and registration budgets independent', () => {
    const limiter = createRateLimiter(1, 1_000, createClock().now)
    const loginIpKey = buildAuthRateLimitKey(AUTH_RATE_LIMIT_NAMESPACES.loginIp, '127.0.0.1')
    const loginUsernameKey = buildAuthRateLimitKey(AUTH_RATE_LIMIT_NAMESPACES.loginUsername, 'alice')
    const registerIpKey = buildAuthRateLimitKey(AUTH_RATE_LIMIT_NAMESPACES.registerIp, '127.0.0.1')

    limiter.recordFailure(loginIpKey)

    expect(limiter.isLimited(loginIpKey)).toBe(true)
    expect(limiter.isLimited(loginUsernameKey)).toBe(false)
    expect(limiter.isLimited(registerIpKey)).toBe(false)
  })

  it('can reset a successful account without clearing its IP failure history', () => {
    const limiter = createRateLimiter(1, 1_000, createClock().now)
    const loginIpKey = buildAuthRateLimitKey(AUTH_RATE_LIMIT_NAMESPACES.loginIp, '127.0.0.1')
    const loginUsernameKey = buildAuthRateLimitKey(AUTH_RATE_LIMIT_NAMESPACES.loginUsername, 'alice')

    limiter.recordFailure(loginIpKey)
    limiter.recordFailure(loginUsernameKey)
    limiter.reset(loginUsernameKey)

    expect(limiter.isLimited(loginIpKey)).toBe(true)
    expect(limiter.isLimited(loginUsernameKey)).toBe(false)
  })

  it('evicts the oldest active key when the tracked-key limit is full', () => {
    const limiter = createRateLimiter(1, 1_000, createClock().now, 2)

    limiter.recordFailure('oldest')
    limiter.recordFailure('second')
    limiter.recordFailure('newest')

    expect(limiter.isLimited('oldest')).toBe(false)
    expect(limiter.isLimited('second')).toBe(true)
    expect(limiter.isLimited('newest')).toBe(true)
  })

  it('prunes expired keys before evicting an active key', () => {
    const clock = createClock()
    const limiter = createRateLimiter(1, 1_000, clock.now, 2)

    limiter.recordFailure('expired-1')
    limiter.recordFailure('expired-2')
    clock.advance(1_001)
    limiter.recordFailure('newest')

    expect(limiter.isLimited('expired-1')).toBe(false)
    expect(limiter.isLimited('expired-2')).toBe(false)
    expect(limiter.isLimited('newest')).toBe(true)
  })

  it('does not track keys when configured with a zero-sized key budget', () => {
    const limiter = createRateLimiter(1, 1_000, createClock().now, 0)

    limiter.recordFailure('ignored')

    expect(limiter.isLimited('ignored')).toBe(false)
  })
})

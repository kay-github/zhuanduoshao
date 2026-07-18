import type { VercelRequest } from '@vercel/node'

const WINDOW_MS = 10 * 60 * 1000
// Login only counts failures, so shared-exit IPs (CGNAT, office NAT) are not
// locked out by successful traffic; registration counts every attempt.
const MAX_FAILURES_PER_WINDOW = 50
const MAX_TRACKED_KEYS = 10_000

interface RateWindow {
  count: number
  resetAt: number
}

export interface RateLimiter {
  /** True when the key has exceeded the failure budget in the current window. */
  isLimited(key: string): boolean
  /** Record a failed attempt (or, for registration, any attempt). */
  recordFailure(key: string): void
  /** Clear the counter, e.g. after a successful login. */
  reset(key: string): void
}

export function createRateLimiter(
  maxFailures = MAX_FAILURES_PER_WINDOW,
  windowMs = WINDOW_MS,
  now: () => number = Date.now,
): RateLimiter {
  const windows = new Map<string, RateWindow>()

  function readWindow(key: string) {
    const window = windows.get(key)
    return window && now() < window.resetAt ? window : null
  }

  function pruneExpired() {
    if (windows.size <= MAX_TRACKED_KEYS) {
      return
    }

    const currentMs = now()
    for (const [existingKey, existingWindow] of windows) {
      if (currentMs >= existingWindow.resetAt) {
        windows.delete(existingKey)
      }
    }
  }

  return {
    isLimited(key) {
      const window = readWindow(key)
      return window !== null && window.count >= maxFailures
    },
    recordFailure(key) {
      const window = readWindow(key)

      if (window) {
        window.count += 1
        return
      }

      pruneExpired()
      windows.set(key, { count: 1, resetAt: now() + windowMs })
    },
    reset(key) {
      windows.delete(key)
    },
  }
}

export function readClientIp(req: VercelRequest) {
  const forwarded = req.headers['x-forwarded-for']
  const forwardedValue = Array.isArray(forwarded) ? forwarded[0] : forwarded
  const firstHop = forwardedValue?.split(',')[0]?.trim()

  return firstHop || req.socket?.remoteAddress || 'unknown'
}

// Per-instance limiter shared by the auth endpoints. Serverless instances each
// keep their own window, so this is a soft cap against bursts, not an exact
// global limit — good enough for the MVP.
export const authRateLimiter = createRateLimiter()

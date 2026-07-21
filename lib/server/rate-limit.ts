import type { VercelRequest } from '@vercel/node'

const WINDOW_MS = 10 * 60 * 1000
// Login only counts failures, so shared-exit IPs (CGNAT, office NAT) are not
// locked out by successful traffic; registration counts every attempt.
const MAX_FAILURES_PER_WINDOW = 50
const MAX_TRACKED_KEYS = 10_000

export const AUTH_RATE_LIMIT_NAMESPACES = {
  loginIp: 'login-ip',
  loginUsername: 'login-username',
  registerIp: 'register-ip',
} as const

type AuthRateLimitNamespace = (typeof AUTH_RATE_LIMIT_NAMESPACES)[keyof typeof AUTH_RATE_LIMIT_NAMESPACES]

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
  maxTrackedKeys = MAX_TRACKED_KEYS,
): RateLimiter {
  const windows = new Map<string, RateWindow>()
  const trackedKeyLimit = Math.max(0, Math.floor(maxTrackedKeys))

  function readWindow(key: string, currentMs: number) {
    const window = windows.get(key)

    if (!window || currentMs < window.resetAt) {
      return window ?? null
    }

    windows.delete(key)
    return null
  }

  function pruneExpired(currentMs: number) {
    for (const [existingKey, existingWindow] of windows) {
      if (currentMs >= existingWindow.resetAt) {
        windows.delete(existingKey)
      }
    }
  }

  function makeRoomForNewKey(currentMs: number) {
    if (trackedKeyLimit === 0) {
      return false
    }

    if (windows.size >= trackedKeyLimit) {
      pruneExpired(currentMs)
    }

    if (windows.size >= trackedKeyLimit) {
      const oldestKey = windows.keys().next().value

      if (oldestKey !== undefined) {
        windows.delete(oldestKey)
      }
    }

    return true
  }

  return {
    isLimited(key) {
      const window = readWindow(key, now())
      return window !== null && window.count >= maxFailures
    },
    recordFailure(key) {
      const currentMs = now()
      const window = readWindow(key, currentMs)

      if (window) {
        window.count += 1
        return
      }

      if (makeRoomForNewKey(currentMs)) {
        windows.set(key, { count: 1, resetAt: currentMs + windowMs })
      }
    },
    reset(key) {
      windows.delete(key)
    },
  }
}

export function buildAuthRateLimitKey(namespace: AuthRateLimitNamespace, identifier: string) {
  return `${namespace}:${identifier}`
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

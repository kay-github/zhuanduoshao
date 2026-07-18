import type { VercelRequest } from '@vercel/node'

const WINDOW_MS = 10 * 60 * 1000
const MAX_ATTEMPTS_PER_WINDOW = 20

interface RateWindow {
  count: number
  resetAt: number
}

// Per-instance in-memory limiter. Serverless instances each keep their own
// window, so this is a soft cap against bursts (credential stuffing, batch
// registration), not an exact global limit — good enough for the MVP.
const windows = new Map<string, RateWindow>()

function readClientIp(req: VercelRequest) {
  const forwarded = req.headers['x-forwarded-for']
  const forwardedValue = Array.isArray(forwarded) ? forwarded[0] : forwarded
  const firstHop = forwardedValue?.split(',')[0]?.trim()

  return firstHop || req.socket?.remoteAddress || 'unknown'
}

export function isAuthRateLimited(req: VercelRequest) {
  const now = Date.now()
  const key = readClientIp(req)
  const window = windows.get(key)

  if (!window || now >= window.resetAt) {
    // Opportunistically drop expired windows so the map cannot grow unbounded.
    if (windows.size > 10_000) {
      for (const [existingKey, existingWindow] of windows) {
        if (now >= existingWindow.resetAt) {
          windows.delete(existingKey)
        }
      }
    }

    windows.set(key, { count: 1, resetAt: now + WINDOW_MS })
    return false
  }

  window.count += 1
  return window.count > MAX_ATTEMPTS_PER_WINDOW
}

import { describe, expect, it } from 'vitest'

import { ConfigurationError } from './errors.js'
import { readSession, validateAuthSecret } from './auth.js'

describe('validateAuthSecret', () => {
  it('trims and returns a sufficiently long secret', () => {
    const secret = '0123456789abcdef0123456789abcdef'

    expect(validateAuthSecret(`  ${secret}  `)).toBe(secret)
  })

  it.each([undefined, '', '   ', 'short-secret'])('rejects a missing or short secret: %s', (secret) => {
    expect(() => validateAuthSecret(secret)).toThrow(ConfigurationError)
  })

  it.each([
    'change-me-change-me-change-me-change-me',
    'replace-with-a-long-random-secret',
    'replace-this-with-a-random-auth-secret',
    'your-auth-secret-your-auth-secret-1234',
    'passwordpasswordpasswordpassword',
  ])('rejects a long example or obviously weak value', (secret) => {
    expect(() => validateAuthSecret(secret)).toThrow('AUTH_SECRET 不能使用示例值或占位值')
  })

  it('treats a malformed encoded session cookie as unauthenticated', async () => {
    const request = {
      headers: {
        cookie: 'zhuanduoshao_session=%E0%A4%A',
      },
    } as Parameters<typeof readSession>[0]

    await expect(readSession(request)).resolves.toBeNull()
  })
})

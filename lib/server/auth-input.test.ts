import { describe, expect, it } from 'vitest'

import { BCRYPT_MAX_PASSWORD_BYTES, loginInputSchema, registerInputSchema } from './auth-input.js'

describe('authentication input validation', () => {
  it('accepts passwords up to bcrypt UTF-8 byte limit', () => {
    const asciiPassword = 'a'.repeat(BCRYPT_MAX_PASSWORD_BYTES)
    const multibytePassword = '中'.repeat(BCRYPT_MAX_PASSWORD_BYTES / 3)

    expect(loginInputSchema.safeParse({ username: 'alice', password: asciiPassword }).success).toBe(true)
    expect(registerInputSchema.safeParse({ username: 'alice', password: multibytePassword }).success).toBe(true)
  })

  it('rejects passwords that bcrypt would silently truncate by UTF-8 byte length', () => {
    const asciiPassword = 'a'.repeat(BCRYPT_MAX_PASSWORD_BYTES + 1)
    const multibytePassword = '中'.repeat(BCRYPT_MAX_PASSWORD_BYTES / 3) + '甲'

    expect(loginInputSchema.safeParse({ username: 'alice', password: asciiPassword }).success).toBe(false)
    expect(registerInputSchema.safeParse({ username: 'alice', password: multibytePassword }).success).toBe(false)
  })

  it('keeps registration usernames restricted to the stored canonical alphabet', () => {
    expect(registerInputSchema.safeParse({ username: 'alice_01', password: 'secret1' }).success).toBe(true)
    expect(registerInputSchema.safeParse({ username: '用户名', password: 'secret1' }).success).toBe(false)
  })
})

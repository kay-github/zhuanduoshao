import { describe, expect, it } from 'vitest'

import { isPostgresUniqueViolation } from './errors.js'

describe('isPostgresUniqueViolation', () => {
  it('recognizes a direct PostgreSQL unique violation', () => {
    expect(isPostgresUniqueViolation({ code: '23505' })).toBe(true)
  })

  it('recognizes a driver error wrapped in causes', () => {
    expect(
      isPostgresUniqueViolation({
        cause: {
          cause: { code: '23505' },
        },
      }),
    ).toBe(true)
  })

  it('does not classify unrelated database failures as unique violations', () => {
    expect(isPostgresUniqueViolation({ code: '23503' })).toBe(false)
    expect(isPostgresUniqueViolation(new Error('connection failed'))).toBe(false)
  })
})

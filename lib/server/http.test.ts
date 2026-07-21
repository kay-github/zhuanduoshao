import { describe, expect, it } from 'vitest'

import { hasJsonContentType, parseCookies } from './http.js'

describe('hasJsonContentType', () => {
  it('accepts JSON with an optional charset', () => {
    const request = {
      headers: { 'content-type': 'Application/JSON; charset=utf-8' },
    } as Parameters<typeof hasJsonContentType>[0]

    expect(hasJsonContentType(request)).toBe(true)
  })

  it('rejects form-compatible and missing content types', () => {
    const textRequest = {
      headers: { 'content-type': 'text/plain' },
    } as Parameters<typeof hasJsonContentType>[0]
    const missingRequest = { headers: {} } as Parameters<typeof hasJsonContentType>[0]

    expect(hasJsonContentType(textRequest)).toBe(false)
    expect(hasJsonContentType(missingRequest)).toBe(false)
  })
})

describe('parseCookies', () => {
  it('decodes valid cookie values', () => {
    const request = {
      headers: { cookie: 'first=hello%20world; token=a%3Db' },
    } as Parameters<typeof parseCookies>[0]

    expect(parseCookies(request)).toEqual({ first: 'hello world', token: 'a=b' })
  })

  it('ignores malformed values while retaining other cookies', () => {
    const request = {
      headers: { cookie: 'valid=kept; broken=%E0%A4%A; last=also-kept' },
    } as Parameters<typeof parseCookies>[0]

    expect(parseCookies(request)).toEqual({ valid: 'kept', last: 'also-kept' })
  })
})

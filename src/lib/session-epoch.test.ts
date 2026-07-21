import { describe, expect, it } from 'vitest'

import { createSessionEpoch } from './session-epoch'

describe('createSessionEpoch', () => {
  it('invalidates every request captured before a session transition', () => {
    const sessionEpoch = createSessionEpoch()
    const initialRestore = sessionEpoch.begin()

    expect(sessionEpoch.isCurrent(initialRestore)).toBe(true)

    const login = sessionEpoch.begin()

    expect(sessionEpoch.isCurrent(initialRestore)).toBe(false)
    expect(sessionEpoch.isCurrent(login)).toBe(true)
    expect(sessionEpoch.capture()).toBe(login)

    sessionEpoch.begin()

    expect(sessionEpoch.isCurrent(login)).toBe(false)
  })
})

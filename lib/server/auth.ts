import type { VercelRequest, VercelResponse } from '@vercel/node'
import bcrypt from 'bcryptjs'
import { SignJWT, jwtVerify } from 'jose'

import { parseCookies } from './http'

const SESSION_COOKIE_NAME = 'zhuanduoshao_session'
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7

interface SessionUser {
  userId: string
  username: string
}

function getAuthSecret() {
  if (!process.env.AUTH_SECRET) {
    throw new Error('AUTH_SECRET is required')
  }

  return new TextEncoder().encode(process.env.AUTH_SECRET)
}

function buildCookie(value: string, maxAge: number) {
  const parts = [
    `${SESSION_COOKIE_NAME}=${value}`,
    'Path=/',
    `Max-Age=${maxAge}`,
    'HttpOnly',
    'SameSite=Lax',
  ]

  if (process.env.NODE_ENV === 'production') {
    parts.push('Secure')
  }

  return parts.join('; ')
}

export async function hashPassword(password: string) {
  return bcrypt.hash(password, 12)
}

export async function verifyPassword(password: string, passwordHash: string) {
  return bcrypt.compare(password, passwordHash)
}

export async function createSessionToken(user: SessionUser) {
  return new SignJWT({ username: user.username })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(user.userId)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_MAX_AGE_SECONDS}s`)
    .sign(getAuthSecret())
}

export async function readSession(req: VercelRequest) {
  const token = parseCookies(req)[SESSION_COOKIE_NAME]

  if (!token) {
    return null
  }

  try {
    const { payload } = await jwtVerify(token, getAuthSecret())

    if (typeof payload.sub !== 'string' || typeof payload.username !== 'string') {
      return null
    }

    return {
      userId: payload.sub,
      username: payload.username,
    }
  } catch {
    return null
  }
}

export function setSessionCookie(res: VercelResponse, token: string) {
  res.setHeader('Set-Cookie', buildCookie(token, SESSION_MAX_AGE_SECONDS))
}

export function clearSessionCookie(res: VercelResponse) {
  res.setHeader('Set-Cookie', buildCookie('', 0))
}

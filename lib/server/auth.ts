import type { VercelRequest, VercelResponse } from '@vercel/node'
import bcrypt from 'bcryptjs'
import { SignJWT, jwtVerify } from 'jose'

import { ConfigurationError } from './errors.js'
import { parseCookies } from './http.js'

const SESSION_COOKIE_NAME = 'zhuanduoshao_session'
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7
const MIN_AUTH_SECRET_LENGTH = 32
const AUTH_SECRET_PLACEHOLDER_PATTERN =
  /(change[-_ ]?me|replace[-_ ]?(me|this|with)|your[-_ ]?(auth[-_ ]?)?secret|example[-_ ]?(auth[-_ ]?)?secret)/i

interface SessionUser {
  userId: string
  username: string
}

export function validateAuthSecret(value: string | undefined) {
  const secret = value?.trim()

  if (!secret) {
    throw new ConfigurationError('服务端尚未配置 AUTH_SECRET')
  }

  if (secret.length < MIN_AUTH_SECRET_LENGTH) {
    throw new ConfigurationError(`AUTH_SECRET 至少需要 ${MIN_AUTH_SECRET_LENGTH} 个字符`)
  }

  const compactSecret = secret.toLowerCase().replace(/[^a-z0-9]/g, '')
  const isRepeatedWeakWord = /^(secret|password|changeme|example|test|development|dev)+\d*$/.test(compactSecret)

  if (AUTH_SECRET_PLACEHOLDER_PATTERN.test(secret) || isRepeatedWeakWord) {
    throw new ConfigurationError('AUTH_SECRET 不能使用示例值或占位值')
  }

  return secret
}

function getAuthSecret() {
  return new TextEncoder().encode(validateAuthSecret(process.env.AUTH_SECRET))
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

  const authSecret = getAuthSecret()

  try {
    const { payload } = await jwtVerify(token, authSecret)

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

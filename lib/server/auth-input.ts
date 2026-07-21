import { z } from 'zod'

export const BCRYPT_MAX_PASSWORD_BYTES = 72

const passwordSchema = z
  .string()
  .min(6)
  .max(BCRYPT_MAX_PASSWORD_BYTES)
  .refine((password) => Buffer.byteLength(password, 'utf8') <= BCRYPT_MAX_PASSWORD_BYTES)

export const loginInputSchema = z.object({
  username: z.string().trim().min(3).max(24),
  password: passwordSchema,
})

export const registerInputSchema = z.object({
  username: z.string().trim().min(3).max(24).regex(/^[a-zA-Z0-9_]+$/),
  password: passwordSchema,
})
